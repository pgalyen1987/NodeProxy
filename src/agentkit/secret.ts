import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { gateX402 } from './pay.js';
import { kvSet, kvGetDel } from './kv.js';
import { SECRET_TOOL_NAME } from '../tools.js';

const KEY = (t: string) => `nodeproxy:secret:v1:${t}`;

interface SecretArgs {
  op?: 'store' | 'redeem';
  secret?: string;
  ttl_seconds?: number;
  token?: string;
}

/** Paid: one-time secret relay (store | redeem-and-burn). */
export async function handleSecret(c: Context, bazaar: Record<string, unknown>): Promise<Response> {
  let body: { arguments?: SecretArgs };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const args = body.arguments ?? {};
  const op = args.op ?? 'store';
  if (op !== 'store' && op !== 'redeem') {
    return c.json({ error: 'op must be store or redeem.' }, 400);
  }
  if (op === 'store') {
    if (typeof args.secret !== 'string' || args.secret.length === 0) {
      return c.json({ error: 'store requires a non-empty secret string.' }, 400);
    }
    if (Buffer.byteLength(args.secret, 'utf8') > config.secret.maxSecretBytes) {
      return c.json({ error: `secret exceeds ${config.secret.maxSecretBytes} bytes.` }, 400);
    }
  }
  if (op === 'redeem' && !args.token) {
    return c.json({ error: 'redeem requires a token.' }, 400);
  }

  return gateX402(c, { tool: SECRET_TOOL_NAME, resourcePath: '/agent-secret', bazaar }, async (settled) => {
    let result: Record<string, unknown>;
    if (op === 'store') {
      const ttl = Math.min(Math.max(args.ttl_seconds ?? 3600, 1), config.secret.maxTtlSeconds);
      const token = randomUUID();
      await kvSet(KEY(token), args.secret as string, ttl);
      result = { op, token, expires_in: ttl };
    } else {
      const secret = await kvGetDel(KEY(args.token as string));
      result = secret === null ? { op, found: false } : { op, found: true, secret };
    }

    return c.json(
      {
        content: [{ type: 'text', text: op === 'store' ? `Secret stored as token ${result.token}.` : 'Secret redeemed.' }],
        secret: result,
        settlement: { protocol: 'x402', transaction: settled.transaction, network: settled.network, tool: SECRET_TOOL_NAME }
      },
      200,
      settled.headers
    );
  });
}
