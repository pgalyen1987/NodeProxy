import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentHints, resolvePayment } from '../src/x402/negotiate.js';
import type { HTTPRequestContext } from '@x402/core/server';

function mockContext(headers: Record<string, string> = {}): HTTPRequestContext {
  return {
    adapter: {
      getHeader(name: string) {
        return headers[name] ?? headers[name.toLowerCase()];
      },
      getMethod: () => 'POST',
      getPath: () => '/mcp/execute',
      getUrl: () => 'http://localhost/mcp/execute',
      getAcceptHeader: () => '*/*',
      getUserAgent: () => 'test'
    },
    path: '/mcp/execute',
    method: 'POST'
  };
}

describe('parsePaymentHints', () => {
  it('reads network and payer from body', () => {
    const hints = parsePaymentHints(mockContext(), {
      paymentNetwork: 'eip155:137',
      payerAddress: '0x0000000000000000000000000000000000000001'
    });
    assert.equal(hints.preferredNetwork, 'eip155:137');
    assert.equal(hints.payerAddress, '0x0000000000000000000000000000000000000001');
  });

  it('reads headers when body is absent', () => {
    const hints = parsePaymentHints(
      mockContext({
        'X-Payment-Network': 'eip155:42161',
        'X-Payer-Address': '0x0000000000000000000000000000000000000002'
      })
    );
    assert.equal(hints.preferredNetwork, 'eip155:42161');
    assert.equal(hints.payerAddress, '0x0000000000000000000000000000000000000002');
  });
});

describe('resolvePayment', () => {
  it('uses explicit network when provided', async () => {
    const resolved = await resolvePayment({
      mode: 'auto',
      preferredNetwork: 'eip155:137'
    });
    assert.equal(resolved.network, 'eip155:137');
    assert.equal(resolved.currency, 'USDC');
    assert.equal(resolved.selection, 'explicit');
  });
});
