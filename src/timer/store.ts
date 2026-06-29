import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';

export type TimerMode = 'push' | 'poll';
export type TimerStatus = 'pending' | 'delivered' | 'failed' | 'fired';

export interface TimerRecord {
  id: string;
  mode: TimerMode;
  callbackUrl?: string;
  payload: unknown;
  fireAt: number; // epoch ms
  createdAt: number;
  status: TimerStatus;
  attempts: number;
  lastError?: string;
  deliveredAt?: number;
  deliveryStatusCode?: number;
  payerKey: string;
}

const REC_PREFIX = 'nodeproxy:timer:v1:rec:';
const DUE_INDEX = 'nodeproxy:timer:v1:due'; // ZSET score=fireAt, member=id

let redis: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

// In-memory fallback when REDIS_URL is unset.
const mem = new Map<string, TimerRecord>();

async function connectRedis(): Promise<RedisClientType | null> {
  if (!config.redisUrl) return null;
  if (redis?.isOpen) return redis;
  if (!redisReady) {
    redisReady = (async () => {
      const client = createClient({ url: config.redisUrl });
      client.on('error', (err) => console.error('[timer] Redis error:', err.message));
      await client.connect();
      redis = client as RedisClientType;
      return redis;
    })().catch((err) => {
      console.error('[timer] Redis unavailable, using in-memory store:', err.message);
      redisReady = null;
      return null;
    });
  }
  return redisReady;
}

export async function putTimer(rec: TimerRecord): Promise<void> {
  const r = await connectRedis();
  if (r) {
    await r.set(REC_PREFIX + rec.id, JSON.stringify(rec));
    if (rec.status === 'pending') {
      await r.zAdd(DUE_INDEX, { score: rec.fireAt, value: rec.id });
    }
    return;
  }
  mem.set(rec.id, rec);
}

export async function getTimer(id: string): Promise<TimerRecord | null> {
  const r = await connectRedis();
  if (r) {
    const raw = await r.get(REC_PREFIX + id);
    return raw ? (JSON.parse(raw) as TimerRecord) : null;
  }
  return mem.get(id) ?? null;
}

/** Atomically claim due pending timers so only one worker fires each. */
export async function claimDueTimers(now: number, limit = 50): Promise<TimerRecord[]> {
  const r = await connectRedis();
  if (r) {
    const ids = await r.zRangeByScore(DUE_INDEX, 0, now, { LIMIT: { offset: 0, count: limit } });
    const claimed: TimerRecord[] = [];
    for (const id of ids) {
      // zRem returns 1 only for the worker that wins the claim.
      const won = await r.zRem(DUE_INDEX, id);
      if (won !== 1) continue;
      const rec = await getTimer(id);
      if (rec && rec.status === 'pending') claimed.push(rec);
    }
    return claimed;
  }
  const due: TimerRecord[] = [];
  for (const rec of mem.values()) {
    if (rec.status === 'pending' && rec.fireAt <= now) {
      rec.status = 'fired'; // claim in-memory to avoid double-fire
      due.push(rec);
      if (due.length >= limit) break;
    }
  }
  return due;
}

export async function updateTimer(rec: TimerRecord): Promise<void> {
  const r = await connectRedis();
  if (r) {
    await r.set(REC_PREFIX + rec.id, JSON.stringify(rec), {
      EX: config.timer.pollRetentionSeconds + 60
    });
    return;
  }
  mem.set(rec.id, rec);
}
