import { JSDOM } from 'jsdom';
import { config } from '../config.js';
import { detectBotBlock, stealthHintPayload } from './botDetect.js';
import { assertPublicUrl, UrlSafetyError } from '../lib/urlSafety.js';
import { withParseSlot } from '../lib/guards.js';
import { fetchRenderedHtml } from './playwrightFetch.js';

export type RenderMode = 'jsdom' | 'playwright';

const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'nav',
  'footer',
  'header[role="banner"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '.ad',
  '.ads',
  '.advertisement',
  '#cookie-banner',
  '.cookie-consent'
].join(',');

function extractStructuredHints(doc: Document): string[] {
  const hints: string[] = [];

  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (description?.trim()) {
    hints.push(`> ${description.trim().replace(/\s+/g, ' ')}`);
  }

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    const raw = el.textContent?.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      hints.push('```json', JSON.stringify(parsed, null, 2), '```');
    } catch {
      hints.push('```json', raw, '```');
    }
  });

  return hints;
}

function nodeToMarkdown(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    return `${'#'.repeat(level)} ${text}\n\n`;
  }
  if (tag === 'li') return `- ${text}\n`;
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `${text}\n\n`;
  return `${text}\n`;
}

export function contentWeight(markdown: string): number {
  return markdown
    .replace(/^### SOURCE:.*/m, '')
    .replace(/^## Structured hints[\s\S]*?(?=\n## |\n# |$)/m, '')
    .replace(/^# .*/m, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function isThinMarkdown(markdown: string): boolean {
  return contentWeight(markdown) < config.playwrightMinText;
}

export function htmlToMarkdown(html: string, sourceUrl: string, render: RenderMode = 'jsdom'): string {
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;

  const hints = extractStructuredHints(doc);
  doc.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());

  const title = doc.querySelector('title')?.textContent?.trim();
  const main =
    doc.querySelector('main') ||
    doc.querySelector('[role="main"]') ||
    doc.querySelector('article') ||
    doc.body;

  const parts: string[] = [`### SOURCE: ${sourceUrl}`, `### RENDER: ${render}`, ''];
  if (title) parts.push(`# ${title}`, '');

  if (hints.length > 0) {
    parts.push('## Structured hints', '', ...hints, '');
  }

  const blocks = main?.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,article,section') || [];
  if (blocks.length > 0) {
    for (const block of blocks) {
      const chunk = nodeToMarkdown(block);
      if (chunk) parts.push(chunk);
    }
  } else {
    const fallback = (main?.textContent || '').replace(/\s+/g, ' ').trim();
    parts.push(fallback);
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchStaticHtml(url: string): Promise<string> {
  // Follow redirects manually so each hop is re-validated against the SSRF guard —
  // otherwise a public URL could 30x-redirect into a private/metadata address.
  let current = assertPublicUrl(url).toString();
  let response: Response | undefined;
  for (let hop = 0; hop < 6; hop++) {
    response = await fetch(current, {
      headers: {
        'User-Agent': 'NodeProxy/1.0 (+https://x402.org; LLM surface parser)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      current = assertPublicUrl(new URL(location, current).toString()).toString();
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    throw new Error(`Upstream HTTP ${response?.status ?? 'unreachable'}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > config.maxHtmlBytes) {
    throw new Error(`Upstream HTML exceeds ${config.maxHtmlBytes} byte limit`);
  }

  const html = await response.text();
  if (html.length > config.maxHtmlBytes) {
    throw new Error(`Upstream HTML exceeds ${config.maxHtmlBytes} byte limit`);
  }

  return html;
}

function assertHtmlSize(html: string): void {
  if (html.length > config.maxHtmlBytes) {
    throw new Error(`Rendered HTML exceeds ${config.maxHtmlBytes} byte limit`);
  }
}

export async function parseSurface(
  url: string
): Promise<{ markdown: string; bytes: number; render: RenderMode; stealthHint?: ReturnType<typeof stealthHintPayload> }> {
  return withParseSlot(async () => {
    assertPublicUrl(url);

    const finish = (
      markdown: string,
      render: RenderMode,
      htmlForDetect?: string
    ) => {
      let stealthHint: ReturnType<typeof stealthHintPayload> | undefined;
      if (htmlForDetect) {
        const detection = detectBotBlock(htmlForDetect);
        if (detection.blocked || isThinMarkdown(markdown)) {
          stealthHint = stealthHintPayload(
            config.publicUrl,
            detection.blocked
              ? `Anti-bot wall detected (${detection.kind || 'unknown'})`
              : 'Thin content — page may require stealth rendering',
            config.stealth.priceUsdc
          );
        }
      }
      return { markdown, bytes: markdown.length, render, stealthHint };
    };

    if (config.renderEngine === 'playwright') {
      const html = await fetchRenderedHtml(url);
      assertHtmlSize(html);
      const markdown = htmlToMarkdown(html, url, 'playwright');
      return finish(markdown, 'playwright', html);
    }

    const staticHtml = await fetchStaticHtml(url);
    const jsdomMarkdown = htmlToMarkdown(staticHtml, url, 'jsdom');

    if (config.renderEngine === 'jsdom') {
      return finish(jsdomMarkdown, 'jsdom', staticHtml);
    }

    if (!isThinMarkdown(jsdomMarkdown)) {
      return finish(jsdomMarkdown, 'jsdom', staticHtml);
    }

    try {
      const renderedHtml = await fetchRenderedHtml(url);
      assertHtmlSize(renderedHtml);
      const playwrightMarkdown = htmlToMarkdown(renderedHtml, url, 'playwright');
      if (contentWeight(playwrightMarkdown) >= contentWeight(jsdomMarkdown)) {
        return finish(playwrightMarkdown, 'playwright', renderedHtml);
      }
    } catch (err) {
      console.warn('[nodeproxy] Playwright fallback failed:', err instanceof Error ? err.message : err);
    }

    return finish(jsdomMarkdown, 'jsdom', staticHtml);
  });
}

export { UrlSafetyError };
