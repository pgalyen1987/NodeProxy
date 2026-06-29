import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';

/**
 * Small Redis-backed KV with an in-memory fallback, shared by the agent-plumbing
 * endpoints (inbox / lock / secret). Pure compute — no external paid deps.
 */

let redis: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

interface MemEntry {
  value: string;
  expiresAt: number; // epoch ms; Infinity = no expiry
}
const mem = new Map<string, MemEntry>();

function memGC(): void {
  const now = Date.now();
  for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
}

async function connect(): Promise<RedisClientType | null> {
  if (!config.redisUrl) return null;
  if (redis?.isOpen) return redis;
  if (!redisReady) {
    redisReady = (async () => {
      const client = createClient({ url: config.redisUrl });
      client.on('error', (err) => console.error('[agentkit] Redis error:', err.message));
      await client.connect();
      redis = client as RedisClientType;
      return redis;
    })().catch((err) => {
      console.error('[agentkit] Redis unavailable, using in-memory KV:', err.message);
      redisReady = null;
      return null;
    });
  }
  return redisReady;
}

export async function kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const r = await connect();
  if (r) {
    await r.set(key, value, { EX: ttlSeconds });
    return;
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function kvGet(key: string): Promise<string | null> {
  const r = await connect();
  if (r) return r.get(key);
  memGC();
  return mem.get(key)?.value ?? null;
}

/** Set only if absent (lock acquire). Returns true if this caller set it. */
export async function kvSetNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const r = await connect();
  if (r) {
    const res = await r.set(key, value, { NX: true, EX: ttlSeconds });
    return res === 'OK';
  }
  memGC();
  if (mem.has(key)) return false;
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

/** Delete only if the stored value matches (lock release with token check). */
export async function kvDelIfMatch(key: string, expected: string): Promise<boolean> {
  const r = await connect();
  if (r) {
    const cur = await r.get(key);
    if (cur !== expected) return false;
    await r.del(key);
    return true;
  }
  memGC();
  const cur = mem.get(key);
  if (!cur || cur.value !== expected) return false;
  mem.delete(key);
  return true;
}

/** Atomically read and delete (one-time secret redeem). */
export async function kvGetDel(key: string): Promise<string | null> {
  const r = await connect();
  if (r) {
    // GETDEL is atomic on Redis ≥ 6.2; fall back to get+del otherwise.
    if (typeof (r as { getDel?: unknown }).getDel === 'function') {
      return (r as unknown as { getDel(k: string): Promise<string | null> }).getDel(key);
    }
    const v = await r.get(key);
    if (v !== null) await r.del(key);
    return v;
  }
  memGC();
  const cur = mem.get(key);
  if (!cur) return null;
  mem.delete(key);
  return cur.value;
}

/** Append to a capped FIFO list (inbox capture). */
export async function kvListPush(key: string, value: string, maxLen: number, ttlSeconds: number): Promise<void> {
  const r = await connect();
  if (r) {
    await r.rPush(key, value);
    await r.lTrim(key, -maxLen, -1);
    await r.expire(key, ttlSeconds);
    return;
  }
  memGC();
  const existing = mem.get(key);
  const arr: string[] = existing ? (JSON.parse(existing.value) as string[]) : [];
  arr.push(value);
  while (arr.length > maxLen) arr.shift();
  mem.set(key, { value: JSON.stringify(arr), expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function kvListRange(key: string): Promise<string[]> {
  const r = await connect();
  if (r) return r.lRange(key, 0, -1);
  memGC();
  const existing = mem.get(key);
  return existing ? (JSON.parse(existing.value) as string[]) : [];
}
