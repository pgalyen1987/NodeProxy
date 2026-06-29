import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectBotBlock, stealthHintPayload } from '../src/parser/botDetect.js';
import { extractCaptchaChallenge } from '../src/parser/captchaSolver.js';
import { priceForTool, STEALTH_TOOL_NAME, TOOL_NAME } from '../src/tools.js';

describe('botDetect', () => {
  it('detects Cloudflare challenge pages', () => {
    const html = '<html><title>Just a moment...</title><body>Checking your browser before accessing example.com</body></html>';
    const result = detectBotBlock(html, 'Just a moment...');
    assert.equal(result.blocked, true);
    assert.equal(result.kind, 'cloudflare');
  });

  it('passes normal content', () => {
    const html = '<html><body><main><h1>Hello</h1><p>World</p></main></body></html>';
    const result = detectBotBlock(html);
    assert.equal(result.blocked, false);
  });
});

describe('stealthHintPayload', () => {
  it('includes stealth endpoint and price', () => {
    const hint = stealthHintPayload('https://api.example.com', 'blocked', 0.05);
    assert.equal(hint.tool, 'stealth_markdown_parser');
    assert.match(hint.endpoint, /stealth-scrape$/);
    assert.equal(hint.priceUsdc, 0.05);
  });
});

describe('captchaSolver', () => {
  it('extracts turnstile sitekey', () => {
    const html = '<div class="cf-turnstile" data-sitekey="0xABC123"></div>';
    const challenge = extractCaptchaChallenge(html);
    assert.equal(challenge?.type, 'turnstile');
    assert.equal(challenge?.siteKey, '0xABC123');
  });
});

describe('tool pricing', () => {
  it('charges premium for stealth tool', () => {
    assert.ok(priceForTool(STEALTH_TOOL_NAME) > priceForTool(TOOL_NAME));
  });
});
