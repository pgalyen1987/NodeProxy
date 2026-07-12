import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import type { PaymentRequiredV1, PaymentRequirementsV1 } from '@x402/core/types/v1';
import { encodePaymentResponseHeader } from '@x402/core/http';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from './networks.js';

/** CAIP-2 → x402 v1 network name. Networks with no v1 name are omitted from v1 accepts. */
const CAIP_TO_V1: Record<string, string> = {
  'eip155:1': 'ethereum',
  'eip155:11155111': 'sepolia',
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:137': 'polygon',
  'eip155:80002': 'polygon-amoy',
  'eip155:43114': 'avalanche',
  'eip155:43113': 'avalanche-fuji',
  [SOLANA_MAINNET_CAIP2]: 'solana',
  [SOLANA_DEVNET_CAIP2]: 'solana-devnet'
};

export function caipToV1Network(caip: string): string | undefined {
  return CAIP_TO_V1[caip];
}

export function v1NetworkToCaip(v1: string): string | undefined {
  for (const [caip, name] of Object.entries(CAIP_TO_V1)) {
    if (name === v1) return caip;
  }
  return undefined;
}

type ResourceInfo = {
  url?: string;
  description?: string;
  mimeType?: string;
};

/** Project a v2 PaymentRequirements entry into the v1 wire shape. */
export function toV1Requirements(
  req: PaymentRequirements,
  resource: ResourceInfo = {}
): PaymentRequirementsV1 | null {
  const network = caipToV1Network(String(req.network));
  if (!network) return null;
  const amount = 'amount' in req && req.amount != null ? String(req.amount) : '';
  if (!amount) return null;
  return {
    scheme: req.scheme,
    network: network as PaymentRequirementsV1['network'],
    maxAmountRequired: amount,
    resource: resource.url || '',
    description: resource.description || '',
    mimeType: resource.mimeType || 'application/json',
    outputSchema: {},
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    asset: req.asset,
    extra: (req.extra as Record<string, unknown>) || {}
  };
}

/** Project a v2 PaymentRequired (header) into a v1 body for legacy clients. */
export function toV1PaymentRequired(v2: PaymentRequired): PaymentRequiredV1 {
  const resource = (v2.resource || {}) as ResourceInfo;
  const accepts = (v2.accepts || [])
    .map((req) => toV1Requirements(req as PaymentRequirements, resource))
    .filter((r): r is PaymentRequirementsV1 => r != null);
  return {
    x402Version: 1,
    error: v2.error || 'Payment Required',
    accepts
  };
}

/**
 * Read the payment proof header. v2 uses PAYMENT-SIGNATURE; v1 uses X-PAYMENT.
 * Prefer v2 when both are present.
 */
export function extractPaymentHeader(
  getHeader: (name: string) => string | null | undefined
): string | undefined {
  return (
    getHeader('payment-signature') ||
    getHeader('PAYMENT-SIGNATURE') ||
    getHeader('x-payment') ||
    getHeader('X-PAYMENT') ||
    undefined
  );
}

/** Settlement response headers for both protocol generations. */
export function settleResponseHeaders(settle: Parameters<typeof encodePaymentResponseHeader>[0]): Record<string, string> {
  const encoded = encodePaymentResponseHeader(settle);
  return {
    'PAYMENT-RESPONSE': encoded,
    'X-PAYMENT-RESPONSE': encoded
  };
}

/** Network id from either a v1 or v2 payment payload. */
export function payloadNetwork(payload: {
  x402Version?: number;
  accepted?: { network?: string };
  network?: string;
}): string | undefined {
  if (payload.x402Version === 2) return payload.accepted?.network;
  return payload.network;
}
