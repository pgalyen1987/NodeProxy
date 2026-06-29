import { createClient, type RedisClientType } from 'redis';

/**
 * Shared persistence for accounts, credit balances, and usage analytics.
 * Backed by Redis when REDIS_URL is set; otherwise an in-process Map so the
 * kit still works on a single instance for local dev and small deployments.
 *
 * NOTE: the in-memory fallback is per-process. Run with Redis for multi-replica
 * deployments so balances and usage stay consistent across instances.
 */

const redisUrl = process.env.REDIS_URL?.trim() || '';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

const mem = new Map<string, string>();
const memSets = new Map<string, Set<string>>();
const memZ = new Map<string, Map<string, number>>();

async function redis(): Promise<RedisClientType | null> {
  if (!redisUrl) return null;
  if (client?.isOpen) return client;
  if (!connecting) {
    connecting = (async () => {
      const c = createClient({ url: redisUrl });
      c.on('error', (err) => console.error('[x402-kit] Redis error:', err.message));
      await c.connect();
      client = c as RedisClientType;
      return client;
    })().catch((err) => {
      console.error('[x402-kit] Redis unavailable, using in-memory store:', err.message);
      connecting = null;
      return null;
    });
  }
  return connecting;
}

export function storeBackend(): 'redis' | 'memory' {
  if (!redisUrl) return 'memory';
  return client?.isOpen ? 'redis' : 'memory';
}

export async function kvGet(key: string): Promise<string | null> {
  const r = await redis();
  if (r) return r.get(key);
  return mem.get(key) ?? null;
}

export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const r = await redis();
  if (r) {
    if (ttlSeconds) await r.set(key, value, { EX: ttlSeconds });
    else await r.set(key, value);
    return;
  }
  mem.set(key, value);
}

export async function kvDel(key: string): Promise<void> {
  const r = await redis();
  if (r) {
    await r.del(key);
    return;
  }
  mem.delete(key);
}

/** Atomic numeric increment, returns the new value. Used for credit accrual/draw-down. */
export async function kvIncrByFloat(key: string, delta: number): Promise<number> {
  const r = await redis();
  if (r) return Number(await r.incrByFloat(key, delta));
  const current = parseFloat(mem.get(key) || '0') || 0;
  const next = current + delta;
  mem.set(key, String(next));
  return next;
}

export async function setAdd(key: string, member: string): Promise<void> {
  const r = await redis();
  if (r) {
    await r.sAdd(key, member);
    return;
  }
  const s = memSets.get(key) || new Set<string>();
  s.add(member);
  memSets.set(key, s);
}

export async function setMembers(key: string): Promise<string[]> {
  const r = await redis();
  if (r) return r.sMembers(key);
  return [...(memSets.get(key) || [])];
}

/** Increment a member of a sorted-set-style counter map (used for usage rollups). */
export async function counterIncr(key: string, member: string, by = 1): Promise<void> {
  const r = await redis();
  if (r) {
    await r.zIncrBy(key, by, member);
    return;
  }
  const m = memZ.get(key) || new Map<string, number>();
  m.set(member, (m.get(member) || 0) + by);
  memZ.set(key, m);
}

export async function counterAll(key: string): Promise<Record<string, number>> {
  const r = await redis();
  if (r) {
    const raw = await r.zRangeWithScores(key, 0, -1);
    const out: Record<string, number> = {};
    for (const { value, score } of raw) out[value] = score;
    return out;
  }
  const m = memZ.get(key) || new Map<string, number>();
  return Object.fromEntries(m);
}

export async function closeStore(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
  connecting = null;
}
