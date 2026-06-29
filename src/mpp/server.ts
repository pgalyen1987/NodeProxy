import Stripe from 'stripe';
import { Mppx, stripe as mppStripe } from 'mppx/server';
import { config } from '../config.js';
import { TOOL_DESCRIPTION } from '../tools.js';
import type { MppConfig } from './config.js';

export const EXECUTE_SCOPE = 'POST /mcp/execute';

const STRIPE_API_VERSION = '2026-02-25.preview';

type MppxPaymentResult =
  | { status: 402; challenge: Response }
  | { status: 200; withReceipt: (response?: Response) => Response };

type MppxServer = {
  compose: (...entries: unknown[]) => (input: Request) => Promise<MppxPaymentResult>;
};

let mppxInstance: MppxServer | null = null;
let stripeClient: Stripe | null = null;

export function mppConfig(): MppConfig {
  return config.mpp;
}

export function isMppEnabled(): boolean {
  return config.mpp.enabled;
}

function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(
      config.mpp.stripeSecretKey,
      { apiVersion: STRIPE_API_VERSION } as unknown as ConstructorParameters<typeof Stripe>[1]
    );
  }
  return stripeClient;
}

export function getMppx() {
  if (!isMppEnabled()) {
    throw new Error('MPP is not configured (set MPP_SECRET_KEY and STRIPE_SECRET_KEY).');
  }
  if (!mppxInstance) {
    const mpp = config.mpp;
    const html =
      mpp.stripePublishableKey
        ? {
            publishableKey: mpp.stripePublishableKey,
            createTokenUrl: `${config.publicUrl}/mpp/stripe/create-token`
          }
        : undefined;

    mppxInstance = Mppx.create({
      secretKey: mpp.secretKey,
      realm: new URL(config.publicUrl).host,
      methods: [
        mppStripe.charge({
          client: getStripeClient(),
          networkId: mpp.stripeNetworkId,
          currency: mpp.stripeCurrency,
          decimals: mpp.stripeDecimals,
          paymentMethodTypes: mpp.stripePaymentMethodTypes,
          description: TOOL_DESCRIPTION,
          ...(html ? { html } : {})
        })
      ]
    }) as MppxServer;
  }
  return mppxInstance;
}

export function mppChargeOptions() {
  const mpp = config.mpp;
  return {
    amount: mpp.stripeAmountMinor,
    description: TOOL_DESCRIPTION,
    scope: EXECUTE_SCOPE
  } as const;
}

/** Run MPP payment gate for `/mcp/execute`. Returns 402 challenge or 200 withReceipt wrapper. */
export async function runMppPaymentGate(request: Request) {
  const mppx = getMppx();
  const options = mppChargeOptions();
  const handler = mppx.compose(['stripe/charge', options]);
  return handler(request);
}

function stripeAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

async function postStripeSpt(
  secretKey: string,
  body: URLSearchParams
): Promise<{ id: string }> {
  const isTest = secretKey.startsWith('sk_test_');
  const url =
    process.env.MPP_STRIPE_SPT_URL?.trim() ||
    (isTest
      ? 'https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens'
      : 'https://api.stripe.com/v1/shared_payment/granted_tokens');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: stripeAuthHeader(secretKey),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
    body
  });

  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Failed to create Stripe SPT');
  }
  if (!payload.id) throw new Error('Stripe SPT response missing id');
  return { id: payload.id };
}

/** Create a Stripe Shared Payment Token (SPT) for browser / Elements checkout flows. */
export async function createStripeSpt(body: {
  payment_method: string;
  amount?: string;
  currency?: string;
  networkId?: string;
  expiresAt?: number;
  metadata?: Record<string, string>;
}): Promise<{ spt: string }> {
  const mpp = config.mpp;
  const amount = body.amount ?? mpp.stripeAmountMinor;
  const currency = (body.currency ?? mpp.stripeCurrency).toLowerCase();
  const expiresAt = body.expiresAt ?? Math.floor(Date.now() / 1000) + 3600;
  const networkId = body.networkId ?? mpp.stripeNetworkId;

  const withNetwork = new URLSearchParams({
    payment_method: body.payment_method,
    'usage_limits[currency]': currency,
    'usage_limits[max_amount]': amount,
    'usage_limits[expires_at]': String(expiresAt),
    'seller_details[network_id]': networkId
  });
  if (body.metadata) {
    for (const [key, value] of Object.entries(body.metadata)) {
      withNetwork.set(`metadata[${key}]`, value);
    }
  }

  try {
    const token = await postStripeSpt(mpp.stripeSecretKey, withNetwork);
    return { spt: token.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (!message.includes('Received unknown parameter')) throw err;

    const fallback = new URLSearchParams({
      payment_method: body.payment_method,
      'usage_limits[currency]': currency,
      'usage_limits[max_amount]': amount,
      'usage_limits[expires_at]': String(expiresAt)
    });
    if (body.metadata) {
      for (const [key, value] of Object.entries(body.metadata)) {
        fallback.set(`metadata[${key}]`, value);
      }
    }
    const token = await postStripeSpt(mpp.stripeSecretKey, fallback);
    return { spt: token.id };
  }
}
