import { chromium, type Browser, type BrowserContext } from 'playwright';
import { config } from '../config.js';
import { detectBotBlock } from './botDetect.js';
import { solveCaptcha } from './captchaSolver.js';
import { fetchViaScrapeDo, scrapeDoEnabled } from './scrapeDoFetch.js';

function titleFromHtml(html: string): string {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
}

// scrape.do returns the *final* rendered page, which for Cloudflare-fronted
// sites legitimately still embeds the turnstile widget script — so the broad
// detectBotBlock() would false-positive. Only treat the response as a failed
// unlock if it's an actual challenge interstitial: a block title, or a tiny
// body that is essentially just the Cloudflare challenge shell.
function isChallengeInterstitial(html: string): boolean {
  const title = titleFromHtml(html).toLowerCase();
  if (/just a moment|attention required|checking your browser|verify you are (?:human|a human)|access denied|forbidden/.test(title)) {
    return true;
  }
  return (
    html.length < 15_000 &&
    /cf-browser-verification|cdn-cgi\/challenge-platform|_cf_chl_opt|window\._cf_chl/i.test(html)
  );
}

let stealthBrowser: Browser | null = null;
let stealthBrowserInit: Promise<Browser> | null = null;
let proxyIndex = 0;

export class StealthBlockedError extends Error {
  kind: string | null;
  constructor(message: string, kind: string | null = null) {
    super(message);
    this.name = 'StealthBlockedError';
    this.kind = kind;
  }
}

function nextProxy(): string | undefined {
  const urls = config.stealth.proxyUrls;
  if (urls.length === 0) return undefined;
  const proxy = urls[proxyIndex % urls.length];
  proxyIndex += 1;
  return proxy;
}

async function getStealthBrowser(): Promise<Browser> {
  if (stealthBrowser?.isConnected()) return stealthBrowser;

  if (!stealthBrowserInit) {
    stealthBrowserInit = chromium
      .launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      })
      .then((instance) => {
        stealthBrowser = instance;
        return instance;
      })
      .catch((err) => {
        stealthBrowserInit = null;
        throw err;
      });
  }

  return stealthBrowserInit;
}

async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const proxyUrl = nextProxy();
  const context = await browser.newContext({
    userAgent: config.stealth.userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    javaScriptEnabled: true,
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {})
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

async function injectCaptchaToken(page: import('playwright').Page, token: string, html: string): Promise<void> {
  if (/cf-turnstile/i.test(html)) {
    await page.evaluate((t) => {
      const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
      if (input) input.value = t;
      const textarea = document.querySelector<HTMLTextAreaElement>('#g-recaptcha-response');
      if (textarea) textarea.value = t;
    }, token);
    return;
  }

  if (/g-recaptcha/i.test(html)) {
    await page.evaluate((t) => {
      const el = document.querySelector<HTMLTextAreaElement>('#g-recaptcha-response');
      if (el) el.value = t;
    }, token);
  }
}

export interface StealthFetchResult {
  html: string;
  proxyUsed: boolean;
  captchaSolved: boolean;
  attempts: number;
}

export async function fetchStealthHtml(url: string): Promise<StealthFetchResult> {
  // Primary path: managed unlocker (scrape.do) — residential proxies + JS
  // render + CAPTCHA solved server-side. Only fall through to local Playwright
  // if the token is unset or scrape.do fails/returns a challenge page.
  if (scrapeDoEnabled()) {
    try {
      const { html } = await fetchViaScrapeDo(url);
      if (!isChallengeInterstitial(html)) {
        return { html, proxyUsed: true, captchaSolved: true, attempts: 1 };
      }
    } catch {
      /* fall through to local Playwright */
    }
  }

  const browser = await getStealthBrowser();
  let lastError: Error | null = null;
  let captchaSolved = false;

  for (let attempt = 1; attempt <= config.stealth.maxFetchAttempts; attempt++) {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.stealth.playwrightTimeoutMs
      });
      await page.waitForTimeout(config.stealth.playwrightWaitMs);

      try {
        await page.waitForLoadState('networkidle', {
          timeout: Math.min(config.stealth.playwrightTimeoutMs, 12_000)
        });
      } catch {
        /* continue */
      }

      let html = await page.content();
      let title = await page.title();
      let detection = detectBotBlock(html, title);

      if (detection.blocked && config.stealth.captchaSolverKey) {
        const token = await solveCaptcha(url, html);
        if (token) {
          await injectCaptchaToken(page, token, html);
          captchaSolved = true;
          await page.waitForTimeout(3000);
          try {
            await page.click('button[type="submit"], input[type="submit"]', { timeout: 3000 });
          } catch {
            /* optional submit */
          }
          await page.waitForTimeout(config.stealth.playwrightWaitMs);
          html = await page.content();
          title = await page.title();
          detection = detectBotBlock(html, title);
        }
      }

      if (detection.blocked) {
        throw new StealthBlockedError(
          `Anti-bot challenge remained after stealth fetch (${detection.kind || 'unknown'})`,
          detection.kind
        );
      }

      return {
        html,
        proxyUsed: config.stealth.proxyUrls.length > 0,
        captchaSolved,
        attempts: attempt
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= config.stealth.maxFetchAttempts) break;
    } finally {
      await page.close();
      await context.close();
    }
  }

  throw lastError || new StealthBlockedError('Stealth fetch failed');
}

export async function closeStealthBrowser(): Promise<void> {
  if (stealthBrowser?.isConnected()) {
    await stealthBrowser.close();
  }
  stealthBrowser = null;
  stealthBrowserInit = null;
}
