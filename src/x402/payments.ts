import { x402ResourceServer, type HTTPRequestContext } from '@x402/core/server';
import { x402HTTPResourceServer } from '@x402/core/http';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { config, TOOL_DESCRIPTION } from '../config.js';
import { buildFacilitatorClients } from './facilitators.js';
import { networkPaymentOptions } from './networks.js';
import { parsePaymentHints, resolvePayment, type PaymentHints, toPaymentSummary } from './negotiate.js';

export type { PaymentHints, ResolvedPayment } from './negotiate.js';
export { parsePaymentHints, resolvePayment, toPaymentSummary };

function buildFacilitatorClient() {
  return buildFacilitatorClients(config.facilitatorUrl);
}

function buildAcceptsConfig() {
  return networkPaymentOptions(
    config.networks,
    config.walletAddress || '0x0000000000000000000000000000000000000000',
    config.priceUsdc
  );
}

const facilitator = buildFacilitatorClient();

export const resourceServer = new x402ResourceServer(facilitator)
  .register('eip155:*', new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

export const httpResourceServer = new x402HTTPResourceServer(resourceServer, {
  accepts: buildAcceptsConfig()
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

export async function buildAllToolRequirements(context: HTTPRequestContext): Promise<PaymentRequirements[]> {
  return resourceServer.buildPaymentRequirementsFromOptions(
    networkPaymentOptions(config.networks, config.walletAddress, config.priceUsdc),
    context
  );
}

export async function buildToolRequirements(
  context: HTTPRequestContext,
  hints?: PaymentHints
): Promise<PaymentRequirements[]> {
  const resolvedHints = hints ?? { mode: 'auto' as const };

  if (resolvedHints.mode === 'all') {
    return buildAllToolRequirements(context);
  }

  const resolved = await resolvePayment(resolvedHints);
  return resourceServer.buildPaymentRequirementsFromOptions(
    networkPaymentOptions([resolved.network], config.walletAddress, config.priceUsdc),
    context
  );
}

export async function createToolPaymentChallenge(
  context: HTTPRequestContext,
  resourceUrl: string,
  extensions?: Record<string, unknown>,
  hints?: PaymentHints
) {
  const resolvedHints = hints ?? parsePaymentHints(context);
  const requirements = await buildToolRequirements(context, resolvedHints);
  const paymentRequired = await resourceServer.createPaymentRequiredResponse(
    requirements,
    {
      url: resourceUrl,
      description: TOOL_DESCRIPTION,
      mimeType: 'application/json',
      serviceName: config.serviceName,
      tags: config.serviceTags
    },
    'Payment Required',
    extensions,
    context
  );

  const resolved = await resolvePayment(resolvedHints);
  return {
    paymentRequired,
    requirements,
    payment: toPaymentSummary(resolved),
    mode: resolvedHints.mode
  };
}

export async function verifyAndSettleToolPayment(
  context: HTTPRequestContext,
  paymentHeader: string,
  requirements: PaymentRequirements[],
  transportHeaders?: Record<string, string>
) {
  const payload = decodePaymentHeader(paymentHeader);
  if (!payload) {
    return { ok: false as const, status: 402, message: 'Invalid PAYMENT-SIGNATURE header' };
  }

  const requirement =
    resourceServer.findMatchingRequirements(requirements, payload) ||
    requirements[0];

  let verify;
  try {
    verify = await resourceServer.verifyPayment(payload, requirement, undefined, context);
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

  const settle = await httpResourceServer.processSettlement(payload, requirement, undefined, {
    request: context,
    responseHeaders: transportHeaders
  });

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
      'PAYMENT-RESPONSE': encodePaymentResponseHeader(settle)
    },
    transaction: settle.transaction,
    network: payload.accepted.network
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
