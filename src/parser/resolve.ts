import { getCachedParse, setCachedParse } from '../lib/parseCache.js';
import { parseSurface } from './surface.js';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export interface ResolvedParse {
  markdown: string;
  bytes: number;
  cache: CacheStatus;
  render: 'jsdom' | 'playwright';
  cachedAt?: string;
}

/**
 * Resolve Markdown for a URL after payment has cleared.
 * Payment must be verified by the caller before invoking this function.
 */
export async function resolveSurfaceMarkdown(url: string): Promise<ResolvedParse> {
  const cached = await getCachedParse(url);
  if (cached) {
    const render = cached.markdown.includes('### RENDER: playwright') ? 'playwright' : 'jsdom';
    return {
      markdown: cached.markdown,
      bytes: cached.bytes,
      cache: 'HIT',
      render,
      cachedAt: cached.cachedAt
    };
  }

  const { markdown, bytes, render } = await parseSurface(url);
  await setCachedParse(url, markdown, bytes);
  return { markdown, bytes, cache: 'MISS', render };
}
