import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  consumeProof,
  createToolPaymentChallenge,
  encodePaymentRequiredHeader,
  ensureX402Ready,
  parsePaymentHints,
  releaseProof,
  verifyAndSettleToolPayment,
  buildAllToolRequirements
} from '../x402/payments.js';
import { buildRequestContext } from '../http/context.js';
import { isRateLimited, rateLimitKey } from '../lib/guards.js';
import { recordSettledUsage, hashedIp } from '../billing/index.js';
import { TIMER_TOOL_NAME, priceForTool } from '../tools.js';
import { isSafeCallbackUrl } from './scheduler.js';
import { putTimer, getTimer, type TimerMode, type TimerRecord, type TimerAction } from './store.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

interface TimerActionArg {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface TimerArgs {
  callback_url?: string;
  delay_seconds?: number;
  fire_at?: number; // epoch seconds
  payload?: unknown;
  mode?: TimerMode;
  action?: TimerActionArg;
}

interface TimerCreateBody {
  arguments?: TimerArgs;
  [k: string]: unknown;
}

interface TimerPlan {
  mode: TimerMode;
  callbackUrl?: string;
  fireAt: number;
  payload: unknown;
  action?: TimerAction;
}

/** Validate args and resolve the absolute fire time (epoch ms). Returns an error string or the plan. */
function planTimer(args: TimerArgs): { error: string } | TimerPlan {
  const { minDelaySeconds, maxDelaySeconds, maxPayloadBytes } = config.timer;
  const now = Date.now();

  let fireAt: number;
  if (typeof args.delay_seconds === 'number' && Number.isFinite(args.delay_seconds)) {
    fireAt = now + args.delay_seconds * 1000;
  } else if (typeof args.fire_at === 'number' && Number.isFinite(args.fire_at)) {
    fireAt = args.fire_at * 1000;
  } else {
    return { error: 'Provide delay_seconds (preferred) or fire_at (epoch seconds).' };
  }

  const delta = (fireAt - now) / 1000;
  if (delta < minDelaySeconds) return { error: `Fire time too soon; minimum ${minDelaySeconds}s out.` };
  if (delta > maxDelaySeconds) return { error: `Fire time too far; maximum ${maxDelaySeconds}s out.` };

  if (args.callback_url && !isSafeCallbackUrl(args.callback_url)) {
    return { error: 'callback_url must be a public HTTPS URL (no localhost/private/metadata hosts).' };
  }

  // Action timer: execute an HTTP request at fire time, capture the response for polling.
  if (args.action) {
    const a = args.action;
    if (!a.url) return { error: 'action.url is required.' };
    if (!isSafeCallbackUrl(a.url)) {
      return { error: 'action.url must be a public HTTPS URL (no localhost/private/metadata hosts).' };
    }
    const method = (a.method ?? 'POST').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return { error: `action.method must be one of ${[...ALLOWED_METHODS].join(', ')}.` };
    }
    if (a.body !== undefined && Buffer.byteLength(JSON.stringify(a.body), 'utf8') > maxPayloadBytes) {
      return { error: `action.body exceeds ${maxPayloadBytes} bytes.` };
    }
    const action: TimerAction = { url: a.url, method, headers: a.headers, body: a.body };
    // Action results are always pollable; callback_url (if any) also receives the result.
    return { mode: 'poll', callbackUrl: args.callback_url, fireAt, payload: null, action };
  }

  const mode: TimerMode = args.mode ?? (args.callback_url ? 'push' : 'poll');
  if (mode === 'push' && !args.callback_url) {
    return { error: 'push mode requires callback_url (or supply an action).' };
  }

  const payload = args.payload ?? null;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxPayloadBytes) {
    return { error: `payload exceeds ${maxPayloadBytes} bytes.` };
  }

  return { mode, callbackUrl: args.callback_url, fireAt, payload };
}

export async function handleTimerCreate(c: Context, bazaarExtensions: Record<string, unknown>) {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
  if (isRateLimited(rateLimitKey(ip, c.req.header('user-agent') || 'anon'))) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  let body: TimerCreateBody;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  await ensureX402Ready();

  const priceUsdc = priceForTool(TIMER_TOOL_NAME);
  const context = buildRequestContext(c);
  const resourceUrl = `${config.publicUrl}/agent-timer`;
  const signature = c.req.header('payment-signature') || c.req.header('PAYMENT-SIGNATURE');
  const paymentHints = parsePaymentHints(context, body as Record<string, unknown>);

  // Unpaid requests MUST get a 402 before body validation (Bazaar probe requirement).
  if (!signature) {
    const challenge = await createToolPaymentChallenge(
      context,
      resourceUrl,
      TIMER_TOOL_NAME,
      bazaarExtensions,
      paymentHints,
      priceUsdc
    );
    return c.json(
      {
        ...challenge.paymentRequired,
        message: 'Valid x402 PAYMENT-SIGNATURE required.',
        tool: TIMER_TOOL_NAME,
        priceUsdc,
        payment: challenge.payment,
        x402: challenge.paymentRequired
      },
      402,
      { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge.paymentRequired) }
    );
  }

  if (!consumeProof(signature)) {
    return c.json({ error: 'Payment proof already consumed' }, 409);
  }

  // Validate after confirming payment intent but before settling, so an invalid
  // request isn't charged.
  const plan = planTimer(body.arguments ?? {});
  if ('error' in plan) {
    releaseProof(signature);
    return c.json({ error: plan.error }, 400);
  }

  const requirements = await buildAllToolRequirements(context, priceUsdc);
  const settled = await verifyAndSettleToolPayment(context, signature, requirements);
  if (!settled.ok) {
    releaseProof(signature);
    return c.json({ error: settled.message }, settled.status as 401 | 402);
  }

  await recordSettledUsage({
    service: 'nodeproxy',
    tool: TIMER_TOOL_NAME,
    priceUsdc,
    rail: 'x402',
    caller: settled.network
  });

  const rec: TimerRecord = {
    id: randomUUID(),
    mode: plan.mode,
    callbackUrl: plan.callbackUrl,
    payload: plan.payload,
    action: plan.action,
    fireAt: plan.fireAt,
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    payerKey: hashedIp(c)
  };
  await putTimer(rec);

  const kind = rec.action ? `action ${rec.action.method} ${rec.action.url}` : rec.mode;
  return c.json(
    {
      content: [
        {
          type: 'text',
          text: `Timer ${rec.id} scheduled (${kind}) for ${new Date(rec.fireAt).toISOString()}.`
        }
      ],
      timer: {
        id: rec.id,
        mode: rec.mode,
        kind: rec.action ? 'action' : 'payload',
        fire_at: Math.round(rec.fireAt / 1000),
        status: rec.status,
        poll_url: `${config.publicUrl}/agent-timer/${rec.id}`
      },
      settlement: {
        protocol: 'x402',
        transaction: settled.transaction,
        network: settled.network,
        tool: TIMER_TOOL_NAME
      }
    },
    200,
    settled.headers as Record<string, string>
  );
}

export async function handleTimerPoll(c: Context) {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Timer id required' }, 400);
  const rec = await getTimer(id);
  if (!rec) return c.json({ error: 'Timer not found or expired' }, 404);

  const fired = rec.status === 'fired' || rec.status === 'delivered';
  return c.json({
    id: rec.id,
    mode: rec.mode,
    kind: rec.action ? 'action' : 'payload',
    status: rec.status,
    fire_at: Math.round(rec.fireAt / 1000),
    ready: fired,
    // poll-mode payload, surfaced once fired
    payload: rec.action ? undefined : rec.mode === 'poll' && fired ? rec.payload : undefined,
    // action result (captured HTTP response), surfaced once executed
    action_result: rec.action && fired ? rec.actionResult : undefined,
    delivered_at: rec.deliveredAt ? Math.round(rec.deliveredAt / 1000) : undefined,
    delivery_status_code: rec.deliveryStatusCode,
    last_error: rec.lastError
  });
}
