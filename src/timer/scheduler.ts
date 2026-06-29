import { config } from '../config.js';
import { claimDueTimers, getTimer, updateTimer, putTimer, type TimerRecord } from './store.js';

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

async function tick(): Promise<void> {
  try {
    const due = await claimDueTimers(Date.now());
    for (const rec of due) {
      // re-read to confirm still pending under redis claim
      const fresh = (await getTimer(rec.id)) ?? rec;
      if (fresh.status !== 'pending' && fresh.status !== 'fired') continue;
      fresh.status = 'pending';
      await deliver(fresh);
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
