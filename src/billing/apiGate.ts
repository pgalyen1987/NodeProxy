import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { authorizeCharge } from './accounts.js';
import { recordUsage, type SettlementRail } from './usage.js';

/**
 * Non-crypto fast path: if the caller presents a valid X-API-Key, serve the
 * request and bill their account (prepaid draw-down or postpaid accrual)
 * instead of running the x402 challenge. Usage is recorded on every outcome.
 *
 * Services call `tryApiKeyPayment` first; a null return means "no API key —
 * fall through to the existing x402 / MPP flow".
 */

export function apiKeyFromRequest(c: Context): string | undefined {
  const header = c.req.header('x-api-key') || c.req.header('X-API-Key');
  if (header) return header.trim();
  const auth = c.req.header('authorization') || c.req.header('Authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token.includes('_live_')) return token;
  }
  return undefined;
}

export function hashedIp(c: Context): string {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  return 'ip_' + createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

export interface ApiWorkResult {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ApiKeyPaymentMeta {
  service: string;
  tool: string;
  priceUsdc: number;
}

/**
 * Returns a Hono Response when an API key is present (success or a billing
 * error), or null when no API key was supplied (caller should fall through).
 */
export async function tryApiKeyPayment(
  c: Context,
  meta: ApiKeyPaymentMeta,
  run: () => Promise<ApiWorkResult>
): Promise<Response | null> {
  const rawKey = apiKeyFromRequest(c);
  if (!rawKey) return null;

  const auth = await authorizeCharge(rawKey, meta.priceUsdc);
  if (!auth.ok) {
    await recordUsage({
      ts: Date.now(),
      service: meta.service,
      tool: meta.tool,
      rail: 'api-key',
      outcome: 'refused',
      priceUsdc: meta.priceUsdc,
      caller: auth.account?.id,
      status: 402
    });
    return c.json(
      {
        error: auth.reason || 'API key payment refused',
        rail: 'api-key',
        priceUsdc: meta.priceUsdc,
        ...(auth.account
          ? {
              account: auth.account.id,
              mode: auth.account.mode,
              ...(auth.account.mode === 'prepaid'
                ? { balanceUsdc: auth.account.balanceUsdc, topUp: '/billing/checkout' }
                : { accruedUsdc: auth.account.accruedUsdc, creditLimitUsdc: auth.account.creditLimitUsdc })
            }
          : {})
      },
      auth.reason === 'Unknown API key' ? 401 : 402
    );
  }

  try {
    const result = await run();
    await auth.commit?.();
    await recordUsage({
      ts: Date.now(),
      service: meta.service,
      tool: meta.tool,
      rail: 'api-key',
      outcome: 'served',
      priceUsdc: meta.priceUsdc,
      caller: auth.account?.id,
      cache: (result.body.cache as { status?: string } | undefined)?.status,
      status: 200
    });
    return c.json(
      {
        ...result.body,
        settlement: { protocol: 'api-key', account: auth.account?.id, mode: auth.account?.mode, priceUsdc: meta.priceUsdc }
      },
      200,
      result.headers
    );
  } catch (err) {
    // Work failed after authorization — do NOT commit the charge.
    await recordUsage({
      ts: Date.now(),
      service: meta.service,
      tool: meta.tool,
      rail: 'api-key',
      outcome: 'error',
      priceUsdc: meta.priceUsdc,
      caller: auth.account?.id,
      status: 502
    });
    return c.json({ error: err instanceof Error ? err.message : 'Request failed' }, 502);
  }
}

/** Record a settlement that happened on the x402 / MPP rail (called by services). */
export async function recordSettledUsage(
  meta: ApiKeyPaymentMeta & { rail: SettlementRail; caller?: string; cache?: string; outcome?: 'served' | 'challenged' }
): Promise<void> {
  await recordUsage({
    ts: Date.now(),
    service: meta.service,
    tool: meta.tool,
    rail: meta.rail,
    outcome: meta.outcome || 'served',
    priceUsdc: meta.priceUsdc,
    caller: meta.caller,
    cache: meta.cache,
    status: meta.outcome === 'challenged' ? 402 : 200
  });
}
