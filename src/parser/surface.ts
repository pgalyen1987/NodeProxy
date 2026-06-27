import { JSDOM } from 'jsdom';
import { config } from '../config.js';
import { assertPublicUrl, UrlSafetyError } from '../lib/urlSafety.js';
import { withParseSlot } from '../lib/guards.js';

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

export function htmlToMarkdown(html: string, sourceUrl: string): string {
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;

  doc.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());

  const title = doc.querySelector('title')?.textContent?.trim();
  const main =
    doc.querySelector('main') ||
    doc.querySelector('[role="main"]') ||
    doc.querySelector('article') ||
    doc.body;

  const parts: string[] = [`### SOURCE: ${sourceUrl}`, ''];
  if (title) parts.push(`# ${title}`, '');

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

export async function parseSurface(url: string): Promise<{ markdown: string; bytes: number }> {
  return withParseSlot(async () => {
    assertPublicUrl(url);

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

    const markdown = htmlToMarkdown(html, url);
    return { markdown, bytes: markdown.length };
  });
}

export { UrlSafetyError };
