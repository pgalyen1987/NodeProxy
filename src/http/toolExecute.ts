import type { Context } from 'hono';
import { config } from '../config.js';
import {
  consumeProof,
  createToolPaymentChallenge,
  encodePaymentRequiredHeader,
  ensureX402Ready,
  parsePaymentHints,
  releaseProof,
  verifyAndSettleToolPayment,
  buildAllToolRequirements
} from '../x402/payments.js';
import { buildRequestContext } from './context.js';
import { isRateLimited, rateLimitKey } from '../lib/guards.js';
import { hasMppCredential, responseHeaderRecord } from '../mpp/credential.js';
import { isMppEnabled, runMppPaymentGate, mppChargeOptions } from '../mpp/server.js';
import { respondWithParseResult, buildParseWebResponse, runParse } from './parseResponse.js';
import { TOOL_NAME, type ToolName, priceForTool } from '../tools.js';
import { UrlSafetyError } from '../parser/surface.js';
import { ConcurrencyError } from '../lib/guards.js';
import { tryApiKeyPayment, recordSettledUsage, hashedIp } from '../billing/index.js';

export interface ToolExecuteOptions {
  tool: ToolName;
  resourcePath: string;
  bazaarExtensions: Record<string, unknown>;
  /** MPP only supported on standard tool for now */
  allowMpp?: boolean;
}

export async function handleToolExecute(c: Context, body: { arguments?: { url?: string } }, options: ToolExecuteOptions) {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
  if (isRateLimited(rateLimitKey(ip, c.req.header('user-agent') || 'anon'))) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  if (!body.arguments?.url) {
    return c.json({ error: 'Invalid tool routing parameters.' }, 400);
  }

  await ensureX402Ready();

  const priceUsdc = priceForTool(options.tool);
  const context = buildRequestContext(c);
  const resourceUrl = `${config.publicUrl}${options.resourcePath}`;
  const signature = c.req.header('payment-signature') || c.req.header('PAYMENT-SIGNATURE');
  const mppAuth = c.req.header('authorization') || c.req.header('Authorization');
  const paymentHints = parsePaymentHints(context, body as Record<string, unknown>);
  const useMpp = Boolean(options.allowMpp && isMppEnabled() && hasMppCredential(c.req.raw));

  // Non-crypto fast path: a valid X-API-Key bills the account and bypasses x402.
  // Checked before MPP/x402 so an API-key caller never sees a 402 challenge.
  const url = body.arguments.url;
  const apiKeyResponse = await tryApiKeyPayment(
    c,
    { service: 'nodeproxy', tool: options.tool, priceUsdc },
    async () => await runParse(url, options.tool)
  );
  if (apiKeyResponse) return apiKeyResponse;

  if (!signature && !useMpp) {
    const challenge = await createToolPaymentChallenge(
      context,
      resourceUrl,
      options.tool,
      options.bazaarExtensions,
      paymentHints,
      priceUsdc
    );
    const payload: Record<string, unknown> = {
      error: 'Payment Required',
      message:
        options.allowMpp && isMppEnabled()
          ? 'Pay with x402 (PAYMENT-SIGNATURE) or Stripe MPP (Authorization: Payment …).'
          : 'Valid x402 PAYMENT-SIGNATURE required.',
      tool: options.tool,
      priceUsdc,
      payment: challenge.payment,
      x402: challenge.paymentRequired
    };
    const headers: Record<string, string> = {
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge.paymentRequired)
    };

    if (options.allowMpp && isMppEnabled()) {
      const mppResult = await runMppPaymentGate(c.req.raw);
      if (mppResult.status === 402) {
        Object.assign(headers, responseHeaderRecord(mppResult.challenge));
        payload.mpp = {
          protocol: 'mpp',
          methods: ['stripe/charge'],
          charge: mppChargeOptions(),
          createTokenUrl: `${config.publicUrl}/mpp/stripe/create-token`
        };
      }
    }

    return c.json(payload, 402, headers);
  }

  if (useMpp) {
    const proofKey = mppAuth || '';
    if (proofKey && !consumeProof(proofKey)) {
      return c.json({ error: 'Payment proof already consumed' }, 409);
    }

    const mppResult = await runMppPaymentGate(c.req.raw);
    if (mppResult.status === 402) {
      if (proofKey) releaseProof(proofKey);
      return mppResult.challenge;
    }

    const parseResponse = await buildParseWebResponse(
      body.arguments.url,
      TOOL_NAME,
      { protocol: 'mpp', method: 'stripe/charge', tool: TOOL_NAME },
      proofKey || undefined
    );
    if (parseResponse.status !== 200) return parseResponse;
    await recordSettledUsage({ service: 'nodeproxy', tool: options.tool, priceUsdc, rail: 'mpp', caller: hashedIp(c) });
    return mppResult.withReceipt(parseResponse);
  }

  if (!signature) {
    return c.json({ error: 'PAYMENT-SIGNATURE required for x402 settlement' }, 402);
  }

  if (!consumeProof(signature)) {
    return c.json({ error: 'Payment proof already consumed' }, 409);
  }

  const requirements = await buildAllToolRequirements(context, priceUsdc);
  const settled = await verifyAndSettleToolPayment(context, signature, requirements);

  if (!settled.ok) {
    releaseProof(signature);
    return c.json({ error: settled.message }, settled.status as 401 | 402);
  }

  await recordSettledUsage({
    service: 'nodeproxy',
    tool: options.tool,
    priceUsdc,
    rail: 'x402',
    caller: settled.network
  });

  try {
    return respondWithParseResult(
      c,
      body.arguments.url,
      options.tool,
      {
        protocol: 'x402',
        transaction: settled.transaction,
        network: settled.network,
        tool: options.tool
      },
      settled.headers,
      signature
    );
  } catch (err) {
    releaseProof(signature);
    if (err instanceof UrlSafetyError) return c.json({ error: err.message }, 400);
    if (err instanceof ConcurrencyError) return c.json({ error: err.message }, 503);
    return c.json({ error: err instanceof Error ? err.message : 'Parse failed' }, 502);
  }
}
