import { JSDOM } from 'jsdom';
import { config } from '../config.js';
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
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'NodeProxy/1.0 (+https://x402.org; LLM surface parser)',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000)
  });

  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}`);
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
): Promise<{ markdown: string; bytes: number; render: RenderMode }> {
  return withParseSlot(async () => {
    assertPublicUrl(url);

    if (config.renderEngine === 'playwright') {
      const html = await fetchRenderedHtml(url);
      assertHtmlSize(html);
      const markdown = htmlToMarkdown(html, url, 'playwright');
      return { markdown, bytes: markdown.length, render: 'playwright' as const };
    }

    const staticHtml = await fetchStaticHtml(url);
    const jsdomMarkdown = htmlToMarkdown(staticHtml, url, 'jsdom');

    if (config.renderEngine === 'jsdom') {
      return { markdown: jsdomMarkdown, bytes: jsdomMarkdown.length, render: 'jsdom' as const };
    }

    if (!isThinMarkdown(jsdomMarkdown)) {
      return { markdown: jsdomMarkdown, bytes: jsdomMarkdown.length, render: 'jsdom' as const };
    }

    try {
      const renderedHtml = await fetchRenderedHtml(url);
      assertHtmlSize(renderedHtml);
      const playwrightMarkdown = htmlToMarkdown(renderedHtml, url, 'playwright');
      if (contentWeight(playwrightMarkdown) >= contentWeight(jsdomMarkdown)) {
        return { markdown: playwrightMarkdown, bytes: playwrightMarkdown.length, render: 'playwright' as const };
      }
    } catch (err) {
      console.warn('[nodeproxy] Playwright fallback failed:', err instanceof Error ? err.message : err);
    }

    return { markdown: jsdomMarkdown, bytes: jsdomMarkdown.length, render: 'jsdom' as const };
  });
}

export { UrlSafetyError };
