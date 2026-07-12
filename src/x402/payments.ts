import { x402ResourceServer, type HTTPRequestContext } from '@x402/core/server';
import { x402HTTPResourceServer } from '@x402/core/http';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import type { PaymentRequirementsV1 } from '@x402/core/types/v1';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { config } from '../config.js';
import { descriptionForTool, type ToolName } from '../tools.js';
import { buildFacilitatorClients } from './facilitators.js';
import { networkPaymentOptions } from './networks.js';
import { parsePaymentHints, resolvePayment, type PaymentHints, toPaymentSummary } from './negotiate.js';
import {
  payloadNetwork,
  settleResponseHeaders,
  toV1PaymentRequired,
  toV1Requirements
} from './v1.js';

export type { PaymentHints, ResolvedPayment } from './negotiate.js';
export { parsePaymentHints, resolvePayment, toPaymentSummary };
export { extractPaymentHeader, toV1PaymentRequired } from './v1.js';

/** Dual-protocol 402 body: top-level v1 + nested v2 under `x402`. */
export function paymentRequiredBody(
  paymentRequiredV2: PaymentRequired,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...toV1PaymentRequired(paymentRequiredV2),
    ...extras,
    x402: paymentRequiredV2
  };
}

function buildFacilitatorClient() {
  return buildFacilitatorClients(config.facilitatorUrl);
}

function buildAcceptsConfig(priceUsdc: number) {
  return networkPaymentOptions(
    config.networks,
    config.walletAddress || '0x0000000000000000000000000000000000000000',
    config.solanaWalletAddress,
    priceUsdc
  );
}

const facilitator = buildFacilitatorClient();

export const resourceServer = new x402ResourceServer(facilitator)
  .register('eip155:*', new ExactEvmScheme())
  .register('solana:*', new ExactSvmScheme())
  .registerExtension(bazaarResourceServerExtension);

export const httpResourceServer = new x402HTTPResourceServer(resourceServer, {
  accepts: buildAcceptsConfig(config.priceUsdc)
});

let ready = false;

export async function ensureX402Ready(): Promise<void> {
  if (ready) return;
  await httpResourceServer.initialize();
  ready = true;
}

export function decodePaymentHeader(header?: string | null): PaymentPayload | null {
  if (!header) return null;
  try {
    return decodePaymentSignatureHeader(header);
  } catch {
    return null;
  }
}

function matchRequirement(
  requirements: PaymentRequirements[],
  payload: PaymentPayload,
  resourceInfo: { url?: string; description?: string; mimeType?: string }
): PaymentRequirements | PaymentRequirementsV1 | null {
  if (payload.x402Version === 2) {
    return (
      resourceServer.findMatchingRequirements(requirements, payload) ||
      requirements.find((r) => r.network === payload.accepted?.network) ||
      requirements[0] ||
      null
    );
  }
  if (payload.x402Version === 1) {
    const v1Reqs = requirements
      .map((r) => toV1Requirements(r, resourceInfo))
      .filter((r): r is PaymentRequirementsV1 => r != null);
    const scheme = (payload as { scheme?: string }).scheme;
    const network = (payload as { network?: string }).network;
    return v1Reqs.find((r) => r.scheme === scheme && r.network === network) || v1Reqs[0] || null;
  }
  return null;
}

export async function buildAllToolRequirements(
  context: HTTPRequestContext,
  priceUsdc = config.priceUsdc
): Promise<PaymentRequirements[]> {
  return resourceServer.buildPaymentRequirementsFromOptions(
    networkPaymentOptions(config.networks, config.walletAddress, config.solanaWalletAddress, priceUsdc),
    context
  );
}

export async function buildToolRequirements(
  context: HTTPRequestContext,
  hints?: PaymentHints,
  priceUsdc = config.priceUsdc
): Promise<PaymentRequirements[]> {
  const resolvedHints = hints ?? { mode: 'auto' as const };

  if (resolvedHints.mode === 'all') {
    return buildAllToolRequirements(context, priceUsdc);
  }

  const resolved = await resolvePayment(resolvedHints);
  return resourceServer.buildPaymentRequirementsFromOptions(
    networkPaymentOptions([resolved.network], config.walletAddress, config.solanaWalletAddress, priceUsdc),
    context
  );
}

export async function createToolPaymentChallenge(
  context: HTTPRequestContext,
  resourceUrl: string,
  tool: ToolName,
  extensions?: Record<string, unknown>,
  hints?: PaymentHints,
  priceUsdc?: number
) {
  const amount = priceUsdc ?? (tool === 'stealth_markdown_parser' ? config.stealth.priceUsdc : config.priceUsdc);
  const resolvedHints = hints ?? parsePaymentHints(context);
  const requirements = await buildToolRequirements(context, resolvedHints, amount);
  const description = descriptionForTool(tool);
  const paymentRequired = await resourceServer.createPaymentRequiredResponse(
    requirements,
    {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
      serviceName: config.serviceName,
      tags: config.serviceTags
    },
    'Payment Required',
    extensions,
    context
  );

  const resolved = await resolvePayment(resolvedHints, amount);
  return {
    paymentRequired,
    paymentRequiredV1: toV1PaymentRequired(paymentRequired),
    requirements,
    payment: toPaymentSummary(resolved),
    mode: resolvedHints.mode,
    resourceInfo: { url: resourceUrl, description, mimeType: 'application/json' }
  };
}

export async function verifyAndSettleToolPayment(
  context: HTTPRequestContext,
  paymentHeader: string,
  requirements: PaymentRequirements[],
  transportHeaders?: Record<string, string>,
  resourceInfo: { url?: string; description?: string; mimeType?: string } = {}
) {
  const payload = decodePaymentHeader(paymentHeader);
  if (!payload) {
    return { ok: false as const, status: 402, message: 'Invalid PAYMENT-SIGNATURE / X-PAYMENT header' };
  }

  const requirement = matchRequirement(requirements, payload, resourceInfo);
  if (!requirement) {
    return { ok: false as const, status: 402, message: 'No matching payment requirements for payload' };
  }

  let verify;
  try {
    verify = await resourceServer.verifyPayment(payload, requirement as PaymentRequirements, undefined, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment verification failed';
    return { ok: false as const, status: 402, message };
  }

  if (!verify.isValid) {
    return {
      ok: false as const,
      status: 401,
      message: verify.invalidMessage || verify.invalidReason || 'Payment verification failed'
    };
  }

  const settle = await httpResourceServer.processSettlement(
    payload,
    requirement as PaymentRequirements,
    undefined,
    {
      request: context,
      responseHeaders: transportHeaders
    }
  );

  if (!settle.success) {
    return {
      ok: false as const,
      status: 402,
      message: settle.errorMessage || settle.errorReason || 'Settlement failed'
    };
  }

  return {
    ok: true as const,
    headers: {
      ...settle.headers,
      ...settleResponseHeaders(settle)
    },
    transaction: settle.transaction,
    network: payloadNetwork(payload) || ''
  };
}

export { encodePaymentRequiredHeader };

const spent = new Set<string>();

export function consumeProof(key: string): boolean {
  if (spent.has(key)) return false;
  if (spent.size > 100_000) {
    const first = spent.values().next().value;
    if (first) spent.delete(first);
  }
  spent.add(key);
  return true;
}

export function releaseProof(key: string): void {
  spent.delete(key);
}
