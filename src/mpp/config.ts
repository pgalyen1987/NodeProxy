function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Stripe SPT card charges require at least $0.50 USD. */
export const STRIPE_SPT_MIN_USD = 0.5;

export interface MppConfig {
  enabled: boolean;
  secretKey: string;
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeNetworkId: string;
  stripeCurrency: string;
  stripePaymentMethodTypes: string[];
  /** Charge amount in USD (major units). Clamped to Stripe SPT minimum when using card. */
  stripeAmountUsd: number;
  /** Amount string in minor units for MPP challenges (e.g. "50" for $0.50). */
  stripeAmountMinor: string;
  stripeDecimals: number;
}

function resolveStripeAmountUsd(): number {
  const raw = envFloat('MPP_STRIPE_AMOUNT_USD', STRIPE_SPT_MIN_USD);
  return Math.max(raw, STRIPE_SPT_MIN_USD);
}

function toMinorUnits(amountUsd: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(amountUsd * factor));
}

export function buildMppConfig(publicUrl: string): MppConfig {
  const secretKey = process.env.MPP_SECRET_KEY?.trim() || '';
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() || '';
  const explicitlyDisabled = process.env.MPP_ENABLED === '0';
  const enabled = !explicitlyDisabled && Boolean(secretKey && stripeSecretKey);

  const stripeDecimals = 2;
  const stripeAmountUsd = resolveStripeAmountUsd();
  const stripePaymentMethodTypes = (process.env.MPP_STRIPE_PAYMENT_METHOD_TYPES || 'card')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  void publicUrl;

  return {
    enabled,
    secretKey,
    stripeSecretKey,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || '',
    stripeNetworkId: process.env.MPP_STRIPE_NETWORK_ID?.trim() || 'internal',
    stripeCurrency: (process.env.MPP_STRIPE_CURRENCY || 'usd').toLowerCase(),
    stripePaymentMethodTypes,
    stripeAmountUsd,
    stripeAmountMinor: toMinorUnits(stripeAmountUsd, stripeDecimals),
    stripeDecimals
  };
}

export function mppSnapshot(mpp: MppConfig) {
  return {
    enabled: mpp.enabled,
    protocol: 'mpp',
    stripe: mpp.enabled
      ? {
          method: 'stripe/charge',
          currency: mpp.stripeCurrency,
          amountUsd: mpp.stripeAmountUsd,
          amountMinor: mpp.stripeAmountMinor,
          networkId: mpp.stripeNetworkId,
          paymentMethodTypes: mpp.stripePaymentMethodTypes,
          minUsd: STRIPE_SPT_MIN_USD
        }
      : null
  };
}
