import { chromium, type Browser } from 'playwright';
import { config } from '../config.js';

let browser: Browser | null = null;
let browserInit: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  if (!browserInit) {
    browserInit = chromium
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })
      .then((instance) => {
        browser = instance;
        return instance;
      })
      .catch((err) => {
        browserInit = null;
        throw err;
      });
  }

  return browserInit;
}

export async function fetchRenderedHtml(url: string): Promise<string> {
  const instance = await getBrowser();
  const page = await instance.newPage({
    userAgent: 'NodeProxy/1.0 (+https://x402.org; LLM surface parser; Playwright)'
  });

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.playwrightTimeoutMs
    });
    await page.waitForTimeout(config.playwrightWaitMs);
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(config.playwrightTimeoutMs, 8000) });
    } catch {
      /* SPA may never reach networkidle — domcontentloaded + wait is enough */
    }
    return await page.content();
  } finally {
    await page.close();
  }
}

export async function closePlaywrightBrowser(): Promise<void> {
  if (browser?.isConnected()) {
    await browser.close();
  }
  browser = null;
  browserInit = null;
}
