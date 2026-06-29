import { config } from '../config.js';
import { assertPublicUrl } from '../lib/urlSafety.js';
import { withStealthParseSlot } from '../lib/guards.js';
import { htmlToMarkdown } from './surface.js';
import { fetchStealthHtml, StealthBlockedError } from './stealthFetch.js';

export type StealthRenderMode = 'stealth';

function assertHtmlSize(html: string): void {
  if (html.length > config.maxHtmlBytes) {
    throw new Error(`Rendered HTML exceeds ${config.maxHtmlBytes} byte limit`);
  }
}

export async function parseStealthSurface(url: string): Promise<{
  markdown: string;
  bytes: number;
  render: StealthRenderMode;
  proxyUsed: boolean;
  captchaSolved: boolean;
  attempts: number;
}> {
  return withStealthParseSlot(async () => {
    assertPublicUrl(url);
    const { html, proxyUsed, captchaSolved, attempts } = await fetchStealthHtml(url);
    assertHtmlSize(html);

    const base = htmlToMarkdown(html, url, 'playwright');
    const markdown = base
      .replace('### RENDER: playwright', '### RENDER: stealth')
      .replace(
        `### SOURCE: ${url}`,
        [
          `### SOURCE: ${url}`,
          `### PROXY: ${proxyUsed ? 'yes' : 'no'}`,
          `### CAPTCHA: ${captchaSolved ? 'solved' : 'none'}`,
          `### ATTEMPTS: ${attempts}`
        ].join('\n')
      );

    return {
      markdown,
      bytes: markdown.length,
      render: 'stealth',
      proxyUsed,
      captchaSolved,
      attempts
    };
  });
}

export { StealthBlockedError };
