import { config } from '../config.js';

export interface ScrapeDoResult {
  html: string;
  status: number;
}

export class ScrapeDoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ScrapeDoError';
    this.status = status;
  }
}

export function scrapeDoEnabled(): boolean {
  return config.stealth.scrapeDoToken.length > 0;
}

/**
 * Fetch a URL through scrape.do's managed unlocker. scrape.do handles the
 * residential-proxy rotation, headless JS rendering and CAPTCHA solving on its
 * side and returns the final rendered HTML, so this is the reliable path for
 * Cloudflare / anti-bot protected pages. The caller (fetchStealthHtml) falls
 * back to local Playwright if this throws.
 */
export async function fetchViaScrapeDo(url: string): Promise<ScrapeDoResult> {
  const { scrapeDoToken, scrapeDoRender, scrapeDoSuper, scrapeDoGeo, playwrightTimeoutMs } = config.stealth;

  const params = new URLSearchParams({ token: scrapeDoToken, url });
  if (scrapeDoRender) params.set('render', 'true');
  if (scrapeDoSuper) params.set('super', 'true'); // residential/mobile pool
  if (scrapeDoGeo) params.set('geoCode', scrapeDoGeo);

  const endpoint = `https://api.scrape.do/?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(playwrightTimeoutMs, 60_000))
    });
  } catch (err) {
    throw new ScrapeDoError(
      `scrape.do request failed: ${err instanceof Error ? err.message : String(err)}`,
      0
    );
  }

  const body = await res.text();
  if (!res.ok) {
    // 401/403 = bad token or exhausted credits; other codes = scrape.do could
    // not unlock the target. Either way, surface it so we try the local path.
    throw new ScrapeDoError(`scrape.do returned HTTP ${res.status}`, res.status);
  }

  return { html: body, status: res.status };
}
