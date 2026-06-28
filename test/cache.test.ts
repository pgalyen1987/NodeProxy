import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedParse, setCachedParse } from '../src/lib/parseCache.js';

describe('parseCache', () => {
  beforeEach(() => {
    process.env.CACHE_ENABLED = '1';
    process.env.REDIS_URL = '';
    process.env.CACHE_MAX_ENTRIES = '10';
    process.env.CACHE_TTL_SECONDS = '600';
  });

  it('stores and retrieves parsed markdown in memory', async () => {
    const url = 'https://example.com/cache-test';
    await setCachedParse(url, '# Hello', 7);
    const hit = await getCachedParse(url);
    assert.ok(hit);
    assert.equal(hit.markdown, '# Hello');
    assert.equal(hit.bytes, 7);
    assert.ok(hit.cachedAt);
  });
});
