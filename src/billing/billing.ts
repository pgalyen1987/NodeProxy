import Stripe from 'stripe';
import {
  attachStripeCustomer,
  creditBalance,
  creditBalanceByStripeCustomer,
  getAccount,
  settlePostpaid,
  type Account
} from './accounts.js';

/**
 * Stripe integration for the non-crypto rail.
 *
 * - Prepaid:  createCheckoutSession() returns a hosted Checkout URL; on
 *             checkout.session.completed the webhook credits the account.
 * - Postpaid: invoicePostpaidAccount() creates a Stripe invoice for accrued
 *             usage and resets the meter.
 *
 * USD is treated 1:1 with the USDC-denominated prices. Configure via env:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BILLING_SUCCESS_URL, BILLING_CANCEL_URL
 */

let stripe: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function client(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripe = new Stripe(key);
  }
  return stripe;
}

export async function ensureStripeCustomer(account: Account): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await client().customers.create({
    name: account.label,
    metadata: { accountId: account.id }
  });
  await attachStripeCustomer(account.id, customer.id);
  return customer.id;
}

export interface CheckoutInput {
  accountId: string;
  creditsUsdc: number;
}

export async function createCheckoutSession(input: CheckoutInput): Promise<{ url: string; sessionId: string }> {
  const account = await getAccount(input.accountId);
  if (!account) throw new Error('Unknown account');
  if (input.creditsUsdc < 1) throw new Error('Minimum top-up is 1.00');

  const customerId = await ensureStripeCustomer(account);
  const successUrl = process.env.BILLING_SUCCESS_URL || `${process.env.PUBLIC_URL || ''}/billing/success`;
  const cancelUrl = process.env.BILLING_CANCEL_URL || `${process.env.PUBLIC_URL || ''}/billing/cancel`;

  const session = await client().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(input.creditsUsdc * 100),
          product_data: { name: `API credit top-up — ${account.label}` }
        }
      }
    ],
    metadata: { accountId: account.id, creditsUsdc: String(input.creditsUsdc) }
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return { url: session.url, sessionId: session.id };
}

/** Verify and process a Stripe webhook. Returns a short status for logging. */
export async function handleWebhook(rawBody: string, signature: string | undefined): Promise<string> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  if (!signature) throw new Error('Missing stripe-signature header');

  const event = await client().webhooks.constructEventAsync(rawBody, signature, secret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = session.metadata?.accountId;
      const creditsUsdc = parseFloat(session.metadata?.creditsUsdc || '0');
      if (accountId && creditsUsdc > 0) {
        await creditBalance(accountId, creditsUsdc);
        return `credited ${creditsUsdc} to ${accountId}`;
      }
      // Fall back to customer-based credit if metadata is missing.
      if (session.customer && session.amount_total) {
        await creditBalanceByStripeCustomer(String(session.customer), session.amount_total / 100);
        return `credited ${session.amount_total / 100} to customer ${String(session.customer)}`;
      }
      return 'checkout.session.completed: nothing to credit';
    }
    default:
      return `ignored ${event.type}`;
  }
}

/** Invoice a postpaid account for accrued usage and reset its meter. */
export async function invoicePostpaidAccount(accountId: string): Promise<{ invoicedUsdc: number; invoiceId?: string }> {
  const account = await getAccount(accountId);
  if (!account) throw new Error('Unknown account');
  if (account.mode !== 'postpaid') throw new Error('Account is not postpaid');
  if (account.accruedUsdc <= 0) return { invoicedUsdc: 0 };

  const customerId = await ensureStripeCustomer(account);
  const amount = account.accruedUsdc;

  await client().invoiceItems.create({
    customer: customerId,
    amount: Math.round(amount * 100),
    currency: 'usd',
    description: `Metered API usage — ${account.label}`
  });
  const invoice = await client().invoices.create({ customer: customerId, auto_advance: true });

  const settled = await settlePostpaid(accountId);
  return { invoicedUsdc: settled?.invoicedUsdc ?? amount, invoiceId: invoice.id };
}
