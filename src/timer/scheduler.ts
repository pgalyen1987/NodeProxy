import { config } from '../config.js';
import { claimDueTimers, getTimer, updateTimer, putTimer, type TimerRecord } from './store.js';

const STRIPPED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(k.toLowerCase())) out[k] = String(v);
  }
  return out;
}

let started = false;

/**
 * Reject callback URLs that target the local network / cloud metadata, so the
 * timer can't be used as an SSRF relay. Hostname-level only (no DNS resolution),
 * which blocks the obvious cases; pair with per-payer rate limiting.
 */
export function isSafeCallbackUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
  // IPv6 loopback / link-local / unique-local
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  // IPv4 private / loopback / link-local ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

async function deliver(rec: TimerRecord): Promise<void> {
  if (rec.mode === 'poll') {
    rec.status = 'fired';
    rec.deliveredAt = Date.now();
    await updateTimer(rec);
    return;
  }

  // push mode
  if (!rec.callbackUrl || !isSafeCallbackUrl(rec.callbackUrl)) {
    rec.status = 'failed';
    rec.lastError = 'callback URL missing or unsafe at delivery time';
    await updateTimer(rec);
    return;
  }

  rec.attempts += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(rec.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NodeProxy-AgentTimer/1.0',
        'X-Timer-Id': rec.id
      },
      body: JSON.stringify({ timer_id: rec.id, fired_at: Date.now(), payload: rec.payload }),
      redirect: 'manual',
      signal: controller.signal
    });
    rec.deliveryStatusCode = res.status;
    if (res.ok) {
      rec.status = 'delivered';
      rec.deliveredAt = Date.now();
    } else if (rec.attempts >= config.timer.maxDeliveryAttempts) {
      rec.status = 'failed';
      rec.lastError = `callback returned HTTP ${res.status}`;
    } else {
      // retry on a later tick
      rec.fireAt = Date.now() + 30_000 * rec.attempts;
      await putTimer(rec); // re-index as pending
      return;
    }
  } catch (err) {
    rec.lastError = err instanceof Error ? err.message : 'delivery failed';
    if (rec.attempts >= config.timer.maxDeliveryAttempts) {
      rec.status = 'failed';
    } else {
      rec.fireAt = Date.now() + 30_000 * rec.attempts;
      await putTimer(rec);
      clearTimeout(timeout);
      return;
    }
  } finally {
    clearTimeout(timeout);
  }
  await updateTimer(rec);
}

/** At fire time, execute the agent-specified HTTP request and capture the response. */
async function executeAction(rec: TimerRecord): Promise<void> {
  const action = rec.action!;
  if (!isSafeCallbackUrl(action.url)) {
    rec.status = 'failed';
    rec.lastError = 'action.url unsafe at execution time';
    await updateTimer(rec);
    return;
  }

  rec.attempts += 1;
  const method = action.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && action.body !== undefined && action.body !== null;
  const headers = sanitizeHeaders(action.headers);
  if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(action.url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(action.body) : undefined,
      redirect: 'manual',
      signal: controller.signal
    });
    const raw = await res.text();
    const truncated = raw.length > config.timer.maxResponseBytes;
    rec.actionResult = {
      status: res.status,
      ok: res.ok,
      body: truncated ? raw.slice(0, config.timer.maxResponseBytes) : raw,
      truncated
    };
    rec.deliveryStatusCode = res.status;
    rec.status = 'delivered'; // the action ran; HTTP status is in actionResult
    rec.deliveredAt = Date.now();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'action request failed';
    if (rec.attempts >= config.timer.maxDeliveryAttempts) {
      rec.status = 'failed';
      rec.lastError = message;
      rec.actionResult = { status: 0, ok: false, body: '', truncated: false, error: message };
    } else {
      rec.fireAt = Date.now() + 30_000 * rec.attempts;
      await putTimer(rec); // re-index as pending for retry
      clearTimeout(timeout);
      return;
    }
  } finally {
    clearTimeout(timeout);
  }

  // Optional: push the captured result to a callback URL too.
  if (rec.callbackUrl && isSafeCallbackUrl(rec.callbackUrl)) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      await fetch(rec.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Timer-Id': rec.id },
        body: JSON.stringify({ timer_id: rec.id, fired_at: Date.now(), action_result: rec.actionResult }),
        redirect: 'manual',
        signal: ctl.signal
      }).finally(() => clearTimeout(t));
    } catch {
      /* result is still pollable; callback push is best-effort */
    }
  }

  await updateTimer(rec);
}

async function fire(rec: TimerRecord): Promise<void> {
  if (rec.action) return executeAction(rec);
  return deliver(rec);
}

async function tick(): Promise<void> {
  try {
    const due = await claimDueTimers(Date.now());
    for (const rec of due) {
      // re-read to confirm still pending under redis claim
      const fresh = (await getTimer(rec.id)) ?? rec;
      if (fresh.status !== 'pending' && fresh.status !== 'fired') continue;
      fresh.status = 'pending';
      await fire(fresh);
    }
  } catch (err) {
    console.error('[timer] tick error:', err instanceof Error ? err.message : err);
  }
}

export function startTimerScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 1000).unref?.();
}
