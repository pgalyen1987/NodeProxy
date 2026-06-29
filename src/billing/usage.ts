import { counterAll, counterIncr, kvGet, kvSet } from './store.js';

/**
 * Usage analytics: every billable request (paid, refused, or errored) is
 * recorded so the operator can see volume, revenue, top callers, and cache
 * efficiency without external tooling. Counters are cheap rollups; a capped
 * ring of recent events supports a live feed.
 */

export type SettlementRail = 'x402' | 'mpp' | 'api-key';
export type UsageOutcome = 'served' | 'challenged' | 'refused' | 'error';

export interface UsageEvent {
  ts: number;
  service: string;
  tool: string;
  rail: SettlementRail | 'none';
  outcome: UsageOutcome;
  priceUsdc: number;
  /** Caller identity: account id, payer address, or hashed ip. */
  caller?: string;
  cache?: 'HIT' | 'MISS' | 'BYPASS' | string;
  status: number;
}

const RECENT_KEY = 'x402kit:usage:recent';
const RECENT_MAX = 500;

function dayBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function recordUsage(event: UsageEvent): Promise<void> {
  const day = dayBucket(event.ts);
  try {
    await counterIncr(`x402kit:usage:calls:${day}`, `${event.tool}:${event.outcome}`, 1);
    await counterIncr('x402kit:usage:calls:total', event.outcome, 1);
    if (event.outcome === 'served') {
      await counterIncr(`x402kit:usage:revenue:${day}`, event.tool, event.priceUsdc);
      await counterIncr('x402kit:usage:revenue:total', event.tool, event.priceUsdc);
      await counterIncr('x402kit:usage:rail', event.rail, 1);
      if (event.caller) await counterIncr('x402kit:usage:bycaller', event.caller, 1);
    }
    if (event.cache) await counterIncr('x402kit:usage:cache', event.cache, 1);

    // Capped ring of recent events for a live feed.
    const raw = await kvGet(RECENT_KEY);
    const list: UsageEvent[] = raw ? (JSON.parse(raw) as UsageEvent[]) : [];
    list.unshift(event);
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    await kvSet(RECENT_KEY, JSON.stringify(list));
  } catch (err) {
    // Analytics must never break the request path.
    console.error('[x402-kit] usage recording failed:', err instanceof Error ? err.message : err);
  }
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

export async function usageSummary(): Promise<Record<string, unknown>> {
  const day = dayBucket(Date.now());
  const [callsTotal, revenueTotal, revenueToday, rail, cache, byCaller] = await Promise.all([
    counterAll('x402kit:usage:calls:total'),
    counterAll('x402kit:usage:revenue:total'),
    counterAll(`x402kit:usage:revenue:${day}`),
    counterAll('x402kit:usage:rail'),
    counterAll('x402kit:usage:cache'),
    counterAll('x402kit:usage:bycaller')
  ]);

  const topCallers = Object.entries(byCaller)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([caller, calls]) => ({ caller, calls }));

  return {
    calls: { ...callsTotal, total: sum(callsTotal) },
    revenueUsdc: { byTool: revenueTotal, total: Math.round(sum(revenueTotal) * 1_000_000) / 1_000_000 },
    revenueTodayUsdc: Math.round(sum(revenueToday) * 1_000_000) / 1_000_000,
    rail,
    cache,
    topCallers
  };
}

export async function recentUsage(limit = 50): Promise<UsageEvent[]> {
  const raw = await kvGet(RECENT_KEY);
  const list: UsageEvent[] = raw ? (JSON.parse(raw) as UsageEvent[]) : [];
  return list.slice(0, Math.min(limit, RECENT_MAX));
}
