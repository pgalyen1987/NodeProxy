import { config } from '../config.js';

const buckets = new Map<string, number[]>();

export function rateLimitKey(ip: string | undefined, fallback: string): string {
  return ip || fallback || 'unknown';
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= config.rateLimitPerMinute) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

let activeParses = 0;

export class ConcurrencyError extends Error {
  status = 503;
  constructor() {
    super('Parser at capacity — retry shortly');
    this.name = 'ConcurrencyError';
  }
}

export async function withParseSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeParses >= config.maxConcurrentParses) {
    throw new ConcurrencyError();
  }
  activeParses += 1;
  try {
    return await fn();
  } finally {
    activeParses -= 1;
  }
}

export function parseCapacitySnapshot() {
  return { active: activeParses, max: config.maxConcurrentParses };
}
