import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  publicAccount,
  setStatus,
  type BillingMode
} from './accounts.js';
import { createCheckoutSession, handleWebhook, invoicePostpaidAccount, stripeEnabled } from './billing.js';
import { recentUsage, usageSummary } from './usage.js';
import { storeBackend } from './store.js';

/**
 * Mountable admin + billing routes shared by all services.
 *
 *   app.route('/', createOpsRoutes())
 *
 * Admin routes (/admin/*) require `Authorization: Bearer $ADMIN_TOKEN`.
 * Billing routes (/billing/*) are public: a Stripe-signed webhook and a
 * self-serve checkout that requires a valid API key.
 */

async function requireAdmin(c: Context, next: Next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: 'Admin API disabled (ADMIN_TOKEN unset)' }, 503);
  const auth = c.req.header('authorization') || c.req.header('Authorization');
  if (auth !== `Bearer ${token}`) return c.json({ error: 'Unauthorized' }, 401);
  await next();
}

export function createOpsRoutes(): Hono {
  const app = new Hono();

  // ---- Admin: account management ----
  app.use('/admin/*', requireAdmin);

  app.get('/admin/usage', async (c) => c.json(await usageSummary()));
  app.get('/admin/usage/recent', async (c) =>
    c.json({ events: await recentUsage(Number(c.req.query('limit')) || 50) })
  );

  app.get('/admin/accounts', async (c) =>
    c.json({ accounts: (await listAccounts()).map(publicAccount) })
  );

  app.post('/admin/accounts', async (c) => {
    let body: { label?: string; mode?: BillingMode; initialBalanceUsdc?: number; creditLimitUsdc?: number; keyPrefix?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!body.label) return c.json({ error: 'label is required' }, 400);
    const mode: BillingMode = body.mode === 'postpaid' ? 'postpaid' : 'prepaid';
    const { account, rawKey } = await createAccount({
      label: body.label,
      mode,
      initialBalanceUsdc: body.initialBalanceUsdc,
      creditLimitUsdc: body.creditLimitUsdc,
      keyPrefix: body.keyPrefix
    });
    // rawKey is returned exactly once — it is not recoverable later.
    return c.json({ account: publicAccount(account), apiKey: rawKey }, 201);
  });

  app.get('/admin/accounts/:id', async (c) => {
    const account = await getAccount(c.req.param('id'));
    if (!account) return c.json({ error: 'Not found' }, 404);
    return c.json({ account: publicAccount(account) });
  });

  app.post('/admin/accounts/:id/suspend', async (c) => {
    const account = await setStatus(c.req.param('id'), 'suspended');
    if (!account) return c.json({ error: 'Not found' }, 404);
    return c.json({ account: publicAccount(account) });
  });

  app.post('/admin/accounts/:id/activate', async (c) => {
    const account = await setStatus(c.req.param('id'), 'active');
    if (!account) return c.json({ error: 'Not found' }, 404);
    return c.json({ account: publicAccount(account) });
  });

  app.delete('/admin/accounts/:id', async (c) => {
    await deleteAccount(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/admin/accounts/:id/invoice', async (c) => {
    if (!stripeEnabled()) return c.json({ error: 'Stripe not configured' }, 503);
    try {
      const result = await invoicePostpaidAccount(c.req.param('id'));
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invoice failed' }, 400);
    }
  });

  // ---- Billing: self-serve top-up + Stripe webhook ----
  app.post('/billing/checkout', async (c) => {
    if (!stripeEnabled()) return c.json({ error: 'Stripe not configured' }, 503);
    let body: { accountId?: string; creditsUsdc?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!body.accountId || !body.creditsUsdc) {
      return c.json({ error: 'accountId and creditsUsdc are required' }, 400);
    }
    try {
      const session = await createCheckoutSession({ accountId: body.accountId, creditsUsdc: body.creditsUsdc });
      return c.json(session);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Checkout failed' }, 400);
    }
  });

  app.post('/billing/webhook', async (c) => {
    if (!stripeEnabled()) return c.json({ error: 'Stripe not configured' }, 503);
    const signature = c.req.header('stripe-signature');
    const rawBody = await c.req.text();
    try {
      const status = await handleWebhook(rawBody, signature);
      return c.json({ ok: true, status });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Webhook error' }, 400);
    }
  });

  app.get('/billing/status', (c) =>
    c.json({ stripe: stripeEnabled(), store: storeBackend(), adminApi: Boolean(process.env.ADMIN_TOKEN) })
  );

  return app;
}
