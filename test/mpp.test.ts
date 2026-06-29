import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMppConfig, STRIPE_SPT_MIN_USD } from '../src/mpp/config.js';
import { hasMppCredential } from '../src/mpp/credential.js';

describe('MPP config', () => {
  it('stays disabled without secrets', () => {
    const mpp = buildMppConfig('https://example.com');
    assert.equal(mpp.enabled, false);
  });

  it('clamps Stripe amount to SPT minimum', () => {
    const prev = { ...process.env };
    process.env.MPP_SECRET_KEY = 'test-secret-key-32-bytes-minimum!!';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.MPP_STRIPE_AMOUNT_USD = '0.002';
    try {
      const mpp = buildMppConfig('https://example.com');
      assert.equal(mpp.enabled, true);
      assert.equal(mpp.stripeAmountUsd, STRIPE_SPT_MIN_USD);
      assert.equal(mpp.stripeAmountMinor, '50');
    } finally {
      process.env = prev;
    }
  });
});

describe('MPP credential detection', () => {
  it('detects Authorization Payment header', () => {
    const req = new Request('https://example.com/mcp/execute', {
      headers: { Authorization: 'Payment eyJjaGFsbGVuZ2U' }
    });
    assert.equal(hasMppCredential(req), true);
  });

  it('ignores bearer tokens', () => {
    const req = new Request('https://example.com/mcp/execute', {
      headers: { Authorization: 'Bearer abc' }
    });
    assert.equal(hasMppCredential(req), false);
  });
});
