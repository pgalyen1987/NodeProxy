import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { gateX402 } from './pay.js';
import { kvSetNX, kvDelIfMatch, kvGet } from './kv.js';
import { LOCK_TOOL_NAME } from '../tools.js';

const KEY = (k: string) => `nodeproxy:lock:v1:${k}`;

interface LockArgs {
  op?: 'claim' | 'release' | 'check';
  key?: string;
  ttl_seconds?: number;
  token?: string;
}

/** Paid: distributed lock / idempotency op (claim | release | check). */
export async function handleLock(c: Context, bazaar: Record<string, unknown>): Promise<Response> {
  let body: { arguments?: LockArgs };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const args = body.arguments ?? {};
  const op = args.op ?? 'claim';
  const key = args.key;
  if (!key || typeof key !== 'string' || key.length > 256) {
    return c.json({ error: 'key is required (string, <=256 chars).' }, 400);
  }
  if (op !== 'claim' && op !== 'release' && op !== 'check') {
    return c.json({ error: 'op must be claim, release, or check.' }, 400);
  }
  if (op === 'release' && !args.token) {
    return c.json({ error: 'release requires the token from claim.' }, 400);
  }

  return gateX402(c, { tool: LOCK_TOOL_NAME, resourcePath: '/agent-lock', bazaar }, async (settled) => {
    let result: Record<string, unknown>;
    if (op === 'claim') {
      const ttl = Math.min(Math.max(args.ttl_seconds ?? 300, 1), config.lock.maxTtlSeconds);
      const token = randomUUID();
      const acquired = await kvSetNX(KEY(key), token, ttl);
      result = acquired ? { op, key, acquired: true, token, ttl_seconds: ttl } : { op, key, acquired: false };
    } else if (op === 'release') {
      const released = await kvDelIfMatch(KEY(key), args.token as string);
      result = { op, key, released };
    } else {
      const held = (await kvGet(KEY(key))) !== null;
      result = { op, key, held };
    }

    return c.json(
      {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        lock: result,
        settlement: { protocol: 'x402', transaction: settled.transaction, network: settled.network, tool: LOCK_TOOL_NAME }
      },
      200,
      settled.headers
    );
  });
}
