import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAINNET_NETWORKS,
  defaultMainnetNetworks,
  filterNetworksForFacilitator,
  parseNetworkList,
  usdcForNetwork
} from '../src/x402/networks.js';

describe('parseNetworkList', () => {
  it('parses comma-separated networks and dedupes', () => {
    const list = parseNetworkList('eip155:8453,eip155:1,eip155:8453', 'eip155:8453');
    assert.deepEqual(list, ['eip155:8453', 'eip155:1']);
  });

  it('falls back to single network when unset', () => {
    assert.deepEqual(parseNetworkList(undefined, 'eip155:84532'), ['eip155:84532']);
  });

  it('rejects unknown networks', () => {
    assert.throws(() => parseNetworkList('eip155:99999', 'eip155:8453'));
  });
});

describe('usdcForNetwork', () => {
  it('maps Base and Ethereum USDC', () => {
    assert.equal(usdcForNetwork('eip155:8453'), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    assert.equal(usdcForNetwork('eip155:1'), '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });

  it('includes default mainnet bundle (CDP EVM)', () => {
    assert.ok(DEFAULT_MAINNET_NETWORKS.includes('eip155:8453'));
    assert.ok(DEFAULT_MAINNET_NETWORKS.includes('eip155:137'));
    assert.ok(!DEFAULT_MAINNET_NETWORKS.includes('eip155:1'));
    assert.ok(defaultMainnetNetworks(true).includes('eip155:1'));
  });

  it('keeps Ethereum L1 when dual facilitator is configured', () => {
    const prevId = process.env.CDP_API_KEY_ID;
    const prevSecret = process.env.CDP_API_KEY_SECRET;
    const prevUrl = process.env.FACILITATOR_URL;
    const prevL1 = process.env.ETHEREUM_L1_FACILITATOR_URL;
    process.env.CDP_API_KEY_ID = 'test';
    process.env.CDP_API_KEY_SECRET = 'test';
    delete process.env.FACILITATOR_URL;
    process.env.ETHEREUM_L1_FACILITATOR_URL = 'https://facilitator.primev.xyz';
    const filtered = filterNetworksForFacilitator(['eip155:8453', 'eip155:1']);
    assert.deepEqual(filtered, ['eip155:8453', 'eip155:1']);
    if (prevId) process.env.CDP_API_KEY_ID = prevId;
    else delete process.env.CDP_API_KEY_ID;
    if (prevSecret) process.env.CDP_API_KEY_SECRET = prevSecret;
    else delete process.env.CDP_API_KEY_SECRET;
    if (prevUrl) process.env.FACILITATOR_URL = prevUrl;
    else delete process.env.FACILITATOR_URL;
    if (prevL1) process.env.ETHEREUM_L1_FACILITATOR_URL = prevL1;
    else delete process.env.ETHEREUM_L1_FACILITATOR_URL;
  });

  it('filters Ethereum L1 when CDP-only without L1 facilitator', () => {
    const prevId = process.env.CDP_API_KEY_ID;
    const prevSecret = process.env.CDP_API_KEY_SECRET;
    const prevUrl = process.env.FACILITATOR_URL;
    process.env.CDP_API_KEY_ID = 'test';
    process.env.CDP_API_KEY_SECRET = 'test';
    delete process.env.FACILITATOR_URL;
    delete process.env.ETHEREUM_L1_FACILITATOR_URL;
    process.env.X402_INCLUDE_ETHEREUM_L1 = '0';
    const filtered = filterNetworksForFacilitator(['eip155:8453', 'eip155:1']);
    assert.deepEqual(filtered, ['eip155:8453']);
    delete process.env.X402_INCLUDE_ETHEREUM_L1;
    if (prevId) process.env.CDP_API_KEY_ID = prevId;
    else delete process.env.CDP_API_KEY_ID;
    if (prevSecret) process.env.CDP_API_KEY_SECRET = prevSecret;
    else delete process.env.CDP_API_KEY_SECRET;
    if (prevUrl) process.env.FACILITATOR_URL = prevUrl;
  });
});
