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
import { buildRequestContext } from '../http/context.js';
import { isRateLimited, rateLimitKey } from '../lib/guards.js';
import { recordSettledUsage, hashedIp } from '../billing/index.js';
import { priceForTool, type ToolName } from '../tools.js';

export interface Settlement {
  transaction?: string;
  network?: string;
  headers: Record<string, string>;
}

export interface GateOptions {
  tool: ToolName;
  resourcePath: string;
  bazaar: Record<string, unknown>;
}

/**
 * x402 payment gate shared by the agent-plumbing endpoints. Returns a 402
 * challenge when unpaid, settles when a PAYMENT-SIGNATURE is present, and on
 * success invokes `run(settlement)` to produce the response.
 */
export async function gateX402(
  c: Context,
  opts: GateOptions,
  run: (s: Settlement) => Promise<Response> | Response
): Promise<Response> {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
  if (isRateLimited(rateLimitKey(ip, c.req.header('user-agent') || 'anon'))) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await ensureX402Ready();
  const priceUsdc = priceForTool(opts.tool);
  const context = buildRequestContext(c);
  const signature = c.req.header('payment-signature') || c.req.header('PAYMENT-SIGNATURE');

  if (!signature) {
    return emitChallenge(c, opts);
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
    tool: opts.tool,
    priceUsdc,
    rail: 'x402',
    caller: settled.network
  });

  try {
    return await run({
      transaction: settled.transaction,
      network: settled.network,
      headers: (settled.headers as Record<string, string>) ?? {}
    });
  } catch (err) {
    releaseProof(signature);
    return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
  }
}

/**
 * Emit a bare 402 payment challenge (no settlement). Used for the GET discovery
 * probe so a crawler hitting the resource URL gets a valid x402 response with the
 * bazaar extension instead of a 404/405.
 */
export async function emitChallenge(c: Context, opts: GateOptions): Promise<Response> {
  await ensureX402Ready();
  const priceUsdc = priceForTool(opts.tool);
  const context = buildRequestContext(c);
  const resourceUrl = `${config.publicUrl}${opts.resourcePath}`;
  const challenge = await createToolPaymentChallenge(
    context,
    resourceUrl,
    opts.tool,
    opts.bazaar,
    parsePaymentHints(context, {}),
    priceUsdc
  );
  return c.json(
    {
      error: 'Payment Required',
      message: 'Pay with x402 (PAYMENT-SIGNATURE header) to call this resource.',
      tool: opts.tool,
      priceUsdc,
      payment: challenge.payment,
      x402: challenge.paymentRequired
    },
    402,
    { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge.paymentRequired) }
  );
}

export { hashedIp };
