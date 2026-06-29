import { getCachedParse, setCachedParse } from '../lib/parseCache.js';
import { parseStealthSurface } from './stealthSurface.js';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export interface ResolvedStealthParse {
  markdown: string;
  bytes: number;
  cache: CacheStatus;
  render: 'stealth';
  cachedAt?: string;
  proxyUsed: boolean;
  captchaSolved: boolean;
  attempts: number;
}

export async function resolveStealthMarkdown(url: string): Promise<ResolvedStealthParse> {
  const cached = await getCachedParse(url, 'stealth');
  if (cached) {
    return {
      markdown: cached.markdown,
      bytes: cached.bytes,
      cache: 'HIT',
      render: 'stealth',
      cachedAt: cached.cachedAt,
      proxyUsed: cached.markdown.includes('### PROXY: yes'),
      captchaSolved: cached.markdown.includes('### CAPTCHA: solved'),
      attempts: 1
    };
  }

  const result = await parseStealthSurface(url);
  await setCachedParse(url, result.markdown, result.bytes, 'stealth');
  return { ...result, cache: 'MISS' as const };
}
