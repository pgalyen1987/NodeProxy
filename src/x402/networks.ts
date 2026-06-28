import type { NetworkId } from '../config.js';
import { ethereumL1FacilitatorUrl, usesDualFacilitator } from './facilitators.js';

/** Circle USDC (EIP-3009) by CAIP-2 network id. */
export const USDC_BY_NETWORK: Record<string, string> = {
  'eip155:8453': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:137': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'eip155:10': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  'eip155:480': '0x79A02482d875aB8850E13A73309e7eDA2D8971D6'
};

export const NETWORK_LABELS: Record<string, string> = {
  'eip155:8453': 'Base',
  'eip155:84532': 'Base Sepolia',
  'eip155:1': 'Ethereum',
  'eip155:137': 'Polygon',
  'eip155:42161': 'Arbitrum',
  'eip155:10': 'Optimism',
  'eip155:480': 'World'
};

/** Networks settled by the CDP hosted facilitator (when CDP keys are set). */
export const CDP_SUPPORTED_EVM_NETWORKS: NetworkId[] = [
  'eip155:8453',
  'eip155:137',
  'eip155:42161',
  'eip155:480'
];

/** Default production bundle — CDP EVM mainnets plus optional Ethereum L1 USDC. */
export const DEFAULT_MAINNET_NETWORKS: NetworkId[] = [
  'eip155:8453',
  'eip155:137',
  'eip155:42161'
];

export function defaultMainnetNetworks(includeEthereumL1: boolean): NetworkId[] {
  if (!includeEthereumL1) return [...DEFAULT_MAINNET_NETWORKS];
  return [...DEFAULT_MAINNET_NETWORKS, 'eip155:1'];
}

export function networkLabel(network: NetworkId): string {
  return NETWORK_LABELS[network] || network;
}

export function usdcForNetwork(network: NetworkId): string {
  const asset = USDC_BY_NETWORK[network];
  if (!asset) {
    throw new Error(`Unsupported x402 network: ${network}. Add USDC address to USDC_BY_NETWORK.`);
  }
  return asset;
}

export function isKnownEvmNetwork(network: string): network is NetworkId {
  return network.startsWith('eip155:') && network in USDC_BY_NETWORK;
}

export function parseNetworkList(raw: string | undefined, fallback: NetworkId): NetworkId[] {
  const source = raw?.trim();
  if (!source) return [fallback];

  const seen = new Set<string>();
  const networks: NetworkId[] = [];

  for (const part of source.split(',')) {
    const id = part.trim() as NetworkId;
    if (!id || seen.has(id)) continue;
    if (!isKnownEvmNetwork(id)) {
      throw new Error(`Unknown or unsupported X402 network: ${id}`);
    }
    seen.add(id);
    networks.push(id);
  }

  if (networks.length === 0) {
    throw new Error('X402_NETWORKS must list at least one supported network');
  }

  return networks;
}

export function networkPaymentOptions(
  networks: NetworkId[],
  payTo: string,
  priceUsdc: number,
  maxTimeoutSeconds = 300
) {
  return networks.map((network) => ({
    scheme: 'exact' as const,
    network,
    payTo,
    price: {
      amount: String(Math.round(priceUsdc * 1_000_000)),
      asset: usdcForNetwork(network)
    },
    maxTimeoutSeconds
  }));
}

/** Drop networks the active facilitator cannot settle (e.g. Ethereum L1 on CDP-only). */
export function filterNetworksForFacilitator(networks: NetworkId[]): NetworkId[] {
  const customFacilitator = Boolean(process.env.FACILITATOR_URL?.trim());
  const usesCdp = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && !customFacilitator);

  if (!usesCdp) return networks;

  const allowed = new Set<string>(CDP_SUPPORTED_EVM_NETWORKS);
  if (usesDualFacilitator()) {
    allowed.add('eip155:1');
  }

  const filtered = networks.filter((n) => allowed.has(n));
  const dropped = networks.filter((n) => !allowed.has(n));

  if (dropped.length > 0) {
    console.warn(
      `[nodeproxy] Dropped unsupported networks: ${dropped.join(', ')}. ` +
        'Set FACILITATOR_URL or ETHEREUM_L1_FACILITATOR_URL to enable Ethereum mainnet USDC.'
    );
  }

  const fallback = defaultMainnetNetworks(Boolean(ethereumL1FacilitatorUrl()));
  return filtered.length > 0 ? filtered : fallback;
}
