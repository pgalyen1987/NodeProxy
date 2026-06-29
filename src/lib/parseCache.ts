import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';

export interface CachedParse {
  markdown: string;
  bytes: number;
  cachedAt: string;
}

let redis: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

const memory = new Map<string, { entry: CachedParse; expiresAt: number }>();
const memoryOrder: string[] = [];

function normalizeCacheUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  return u.href;
}

export type CacheTier = 'standard' | 'stealth';

function cacheKey(url: string, tier: CacheTier = 'standard'): string {
  const prefix = tier === 'stealth' ? 'nodeproxy:stealth:v1:' : 'nodeproxy:parse:v1:';
  return `${prefix}${normalizeCacheUrl(url)}`;
}

async function connectRedis(): Promise<RedisClientType | null> {
  if (!config.redisUrl) return null;
  if (redis?.isOpen) return redis;

  if (!redisReady) {
    redisReady = (async () => {
      const client = createClient({ url: config.redisUrl });
      client.on('error', (err) => console.error('[nodeproxy] Redis error:', err.message));
      await client.connect();
      redis = client as RedisClientType;
      return redis;
    })().catch((err) => {
      console.error('[nodeproxy] Redis unavailable, using in-memory cache:', err.message);
      redisReady = null;
      return null;
    });
  }

  return redisReady;
}

function memoryGet(key: string): CachedParse | null {
  const row = memory.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    memory.delete(key);
    const idx = memoryOrder.indexOf(key);
    if (idx >= 0) memoryOrder.splice(idx, 1);
    return null;
  }
  return row.entry;
}

function memorySet(key: string, entry: CachedParse): void {
  if (memory.has(key)) {
    const idx = memoryOrder.indexOf(key);
    if (idx >= 0) memoryOrder.splice(idx, 1);
  }
  memory.set(key, { entry, expiresAt: Date.now() + config.cacheTtlSeconds * 1000 });
  memoryOrder.push(key);
  while (memoryOrder.length > config.cacheMaxEntries) {
    const evict = memoryOrder.shift();
    if (evict) memory.delete(evict);
  }
}

export function cacheBackend(): 'redis' | 'memory' | 'off' {
  if (!config.cacheEnabled) return 'off';
  if (config.redisUrl) return redis?.isOpen ? 'redis' : 'memory';
  return 'memory';
}

export function cacheSnapshot() {
  return {
    enabled: config.cacheEnabled,
    backend: cacheBackend(),
    ttlSeconds: config.cacheTtlSeconds,
    maxEntries: config.cacheMaxEntries,
    memoryEntries: memory.size
  };
}

/** Only call after x402 settlement — never before payment verification. */
export async function getCachedParse(url: string, tier: CacheTier = 'standard'): Promise<CachedParse | null> {
  if (!config.cacheEnabled) return null;

  const key = cacheKey(url, tier);
  const client = await connectRedis();
  if (client) {
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CachedParse;
    } catch {
      return memoryGet(key);
    }
  }

  return memoryGet(key);
}

/** Store a fresh parse result with TTL. */
export async function setCachedParse(
  url: string,
  markdown: string,
  bytes: number,
  tier: CacheTier = 'standard'
): Promise<void> {
  if (!config.cacheEnabled) return;

  const entry: CachedParse = {
    markdown,
    bytes,
    cachedAt: new Date().toISOString()
  };
  const key = cacheKey(url, tier);
  const client = await connectRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(entry), { EX: config.cacheTtlSeconds });
      return;
    } catch {
      /* fall through to memory */
    }
  }

  memorySet(key, entry);
}

export async function closeParseCache(): Promise<void> {
  if (redis?.isOpen) {
    await redis.quit();
  }
  redis = null;
  redisReady = null;
}
