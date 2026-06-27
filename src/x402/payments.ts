import { HTTPFacilitatorClient, x402ResourceServer, type HTTPRequestContext } from '@x402/core/server';
import { x402HTTPResourceServer } from '@x402/core/http';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { createFacilitatorConfig } from '@coinbase/x402';
import { config, priceLabel, TOOL_DESCRIPTION } from '../config.js';

function buildFacilitatorClient(): HTTPFacilitatorClient {
  const cdpId = process.env.CDP_API_KEY_ID;
  const cdpSecret = process.env.CDP_API_KEY_SECRET;

  if (cdpId && cdpSecret) {
    return new HTTPFacilitatorClient(createFacilitatorConfig(cdpId, cdpSecret));
  }

  return new HTTPFacilitatorClient({ url: config.facilitatorUrl });
}

const facilitator = buildFacilitatorClient();

export const resourceServer = new x402ResourceServer(facilitator)
  .register('eip155:*', new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

export const httpResourceServer = new x402HTTPResourceServer(resourceServer, {
  accepts: {
    scheme: 'exact',
    network: config.network,
    payTo: config.walletAddress || '0x0000000000000000000000000000000000000000',
    price: priceLabel()
  }
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

export async function buildToolRequirements(context: HTTPRequestContext): Promise<PaymentRequirements[]> {
  return resourceServer.buildPaymentRequirementsFromOptions(
    [
      {
        scheme: 'exact',
        payTo: config.walletAddress,
        price: priceLabel(),
        network: config.network,
        maxTimeoutSeconds: 300
      }
    ],
    context
  );
}

export async function createToolPaymentChallenge(
  context: HTTPRequestContext,
  resourceUrl: string,
  extensions?: Record<string, unknown>
) {
  const requirements = await buildToolRequirements(context);
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
  return { paymentRequired, requirements };
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

  const verify = await resourceServer.verifyPayment(payload, requirement, undefined, context);
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
    transaction: settle.transaction
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
