import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, contentWeight, isThinMarkdown } from '../src/parser/surface.js';

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

  it('extracts JSON-LD before stripping scripts', () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">{"@type":"Article","name":"Demo"}</script></head><body><main><p>Body</p></main></body></html>`;
    const md = htmlToMarkdown(html, 'https://example.com');
    assert.match(md, /Structured hints/);
    assert.match(md, /"name": "Demo"/);
    assert.doesNotMatch(md, /application\/ld\+json/);
  });

  it('detects thin markdown for auto Playwright escalation', () => {
    const thin = htmlToMarkdown('<html><body><div id="root"></div></body></html>', 'https://spa.example');
    assert.ok(isThinMarkdown(thin));
    assert.ok(contentWeight(thin) < 200);
  });
});
