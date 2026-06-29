import { config } from '../config.js';

export interface CaptchaChallenge {
  type: 'turnstile' | 'recaptcha_v2' | 'hcaptcha';
  siteKey: string;
}

const SITEKEY_PATTERNS: Array<{ type: CaptchaChallenge['type']; pattern: RegExp }> = [
  { type: 'turnstile', pattern: /data-sitekey=["']([^"']+)["'][^>]*class=["'][^"']*cf-turnstile/i },
  { type: 'turnstile', pattern: /cf-turnstile[^>]*data-sitekey=["']([^"']+)["']/i },
  { type: 'recaptcha_v2', pattern: /g-recaptcha[^>]*data-sitekey=["']([^"']+)["']/i },
  { type: 'recaptcha_v2', pattern: /data-sitekey=["']([^"']+)["'][^>]*g-recaptcha/i },
  { type: 'hcaptcha', pattern: /h-captcha[^>]*data-sitekey=["']([^"']+)["']/i }
];

export function extractCaptchaChallenge(html: string): CaptchaChallenge | null {
  for (const { type, pattern } of SITEKEY_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) return { type, siteKey: match[1] };
  }
  return null;
}

async function poll2Captcha(requestId: string, apiKey: string, timeoutMs = 120_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(requestId)}&json=1`
    );
    const body = (await res.json()) as { status: number; request?: string; request_error?: string };
    if (body.status === 1 && body.request) return body.request;
    if (body.request_error && body.request_error !== 'CAPCHA_NOT_READY') {
      throw new Error(`2captcha: ${body.request_error}`);
    }
  }
  throw new Error('2captcha: solve timeout');
}

/** Submit CAPTCHA to 2captcha and return token, or null if solver not configured. */
export async function solveCaptcha(pageUrl: string, html: string): Promise<string | null> {
  const apiKey = config.stealth.captchaSolverKey;
  if (!apiKey) return null;

  const challenge = extractCaptchaChallenge(html);
  if (!challenge) return null;

  const params = new URLSearchParams({ key: apiKey, pageurl: pageUrl, json: '1' });

  if (challenge.type === 'turnstile') {
    params.set('method', 'turnstile');
    params.set('sitekey', challenge.siteKey);
  } else if (challenge.type === 'recaptcha_v2') {
    params.set('method', 'userrecaptcha');
    params.set('googlekey', challenge.siteKey);
  } else {
    params.set('method', 'hcaptcha');
    params.set('sitekey', challenge.siteKey);
  }

  const submit = await fetch(`https://2captcha.com/in.php?${params.toString()}`);
  const submitBody = (await submit.json()) as { status: number; request?: string; request_error?: string };
  if (submitBody.status !== 1 || !submitBody.request) {
    throw new Error(`2captcha submit failed: ${submitBody.request_error || 'unknown'}`);
  }

  return poll2Captcha(submitBody.request, apiKey);
}
