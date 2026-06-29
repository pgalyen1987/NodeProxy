import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { gateX402 } from './pay.js';
import { kvSet, kvGet, kvListPush, kvListRange } from './kv.js';
import { INBOX_TOOL_NAME } from '../tools.js';

const META = (id: string) => `nodeproxy:inbox:v1:meta:${id}`;
const MSGS = (id: string) => `nodeproxy:inbox:v1:msgs:${id}`;

/** Paid: create an ephemeral capture inbox. */
export async function handleInboxCreate(c: Context, bazaar: Record<string, unknown>): Promise<Response> {
  return gateX402(c, { tool: INBOX_TOOL_NAME, resourcePath: '/agent-inbox', bazaar }, async (settled) => {
    const id = randomUUID();
    await kvSet(META(id), JSON.stringify({ createdAt: Date.now() }), config.inbox.ttlSeconds);
    return c.json(
      {
        content: [{ type: 'text', text: `Inbox ${id} created. POST to the ingest URL; poll for captures.` }],
        inbox: {
          id,
          ingest_url: `${config.publicUrl}/agent-inbox/${id}/in`,
          poll_url: `${config.publicUrl}/agent-inbox/${id}`,
          expires_in: config.inbox.ttlSeconds,
          max_messages: config.inbox.maxMessages
        },
        settlement: { protocol: 'x402', transaction: settled.transaction, network: settled.network, tool: INBOX_TOOL_NAME }
      },
      200,
      settled.headers
    );
  });
}

/** Free + public: capture an incoming POST into the inbox. */
export async function handleInboxIngest(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'inbox id required' }, 400);
  const meta = await kvGet(META(id));
  if (!meta) return c.json({ error: 'Inbox not found or expired' }, 404);

  const raw = await c.req.text();
  const body = raw.length > config.inbox.maxBodyBytes ? raw.slice(0, config.inbox.maxBodyBytes) : raw;
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'user-agent', 'x-timer-id', 'x-event-type']) {
    const v = c.req.header(h);
    if (v) headers[h] = v;
  }
  const message = {
    received_at: Math.round(Date.now() / 1000),
    method: c.req.method,
    query: c.req.query(),
    headers,
    body,
    truncated: raw.length > config.inbox.maxBodyBytes
  };
  await kvListPush(MSGS(id), JSON.stringify(message), config.inbox.maxMessages, config.inbox.ttlSeconds);
  return c.json({ ok: true, captured: true });
}

/** Free: poll captured messages. */
export async function handleInboxPoll(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'inbox id required' }, 400);
  const meta = await kvGet(META(id));
  if (!meta) return c.json({ error: 'Inbox not found or expired' }, 404);
  const rows = await kvListRange(MSGS(id));
  const messages = rows.map((r) => JSON.parse(r));
  return c.json({ id, count: messages.length, messages });
}
