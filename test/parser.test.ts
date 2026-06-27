import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../src/parser/surface.js';

describe('htmlToMarkdown', () => {
  it('strips scripts and compresses body text', () => {
    const html = `<!doctype html><html><head><title>Demo</title><script>track()</script><style>.x{}</style></head><body><nav>Menu</nav><main><h1>Hello</h1><p>World   wide</p></main><footer>Legal</footer></body></html>`;
    const md = htmlToMarkdown(html, 'https://example.com');
    assert.match(md, /### SOURCE: https:\/\/example.com/);
    assert.match(md, /# Demo/);
    assert.match(md, /# Hello/);
    assert.match(md, /World wide/);
    assert.doesNotMatch(md, /track\(\)/);
    assert.doesNotMatch(md, /Menu/);
  });
});
