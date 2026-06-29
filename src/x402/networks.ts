import { getUsdcAddress } from '@x402/svm';
import type { Network } from '@x402/core/types';
import type { NetworkId } from '../config.js';
import { getDefaultAsset } from '@x402/evm';
import { ethereumL1FacilitatorUrl, usesDualFacilitator } from './facilitators.js';

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as NetworkId;
export const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as NetworkId;

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
  'eip155:480': 'World',
  [SOLANA_MAINNET_CAIP2]: 'Solana',
  [SOLANA_DEVNET_CAIP2]: 'Solana Devnet'
};

export const CDP_SUPPORTED_EVM_NETWORKS: NetworkId[] = [
  'eip155:8453',
  'eip155:137',
  'eip155:42161',
  'eip155:480'
];

export const CDP_SUPPORTED_SOLANA_NETWORKS: NetworkId[] = [SOLANA_MAINNET_CAIP2];

export const DEFAULT_MAINNET_NETWORKS: NetworkId[] = [
  'eip155:8453',
  'eip155:137',
  'eip155:42161'
];

export const SOLANA_RPC_BY_NETWORK: Partial<Record<NetworkId, string>> = {
  [SOLANA_MAINNET_CAIP2]: 'https://api.mainnet-beta.solana.com',
  [SOLANA_DEVNET_CAIP2]: 'https://api.devnet.solana.com'
};

export function solanaWalletFromEnv(): string {
  return process.env.SOLANA_WALLET_ADDRESS?.trim() || '';
}

export function includeSolanaByDefault(): boolean {
  if (process.env.X402_INCLUDE_SOLANA === '0') return false;
  if (process.env.X402_INCLUDE_SOLANA === '1') return Boolean(solanaWalletFromEnv());
  return Boolean(solanaWalletFromEnv());
}

export function defaultMainnetNetworks(includeEthereumL1: boolean, includeSolana = includeSolanaByDefault()): NetworkId[] {
  const networks: NetworkId[] = [...DEFAULT_MAINNET_NETWORKS];
  if (includeEthereumL1) networks.push('eip155:1');
  if (includeSolana) networks.push(SOLANA_MAINNET_CAIP2);
  return networks;
}

export function networkLabel(network: NetworkId): string {
  return NETWORK_LABELS[network] || network;
}

export function isKnownEvmNetwork(network: string): network is NetworkId {
  return network.startsWith('eip155:') && network in USDC_BY_NETWORK;
}

export function isKnownSolanaNetwork(network: string): network is NetworkId {
  if (!network.startsWith('solana:')) return false;
  try {
    getUsdcAddress(network as Network);
    return true;
  } catch {
    return network === SOLANA_MAINNET_CAIP2 || network === SOLANA_DEVNET_CAIP2;
  }
}

export function isKnownNetwork(network: string): network is NetworkId {
  return isKnownEvmNetwork(network) || isKnownSolanaNetwork(network);
}

export function usdcForNetwork(network: NetworkId): string {
  if (isKnownEvmNetwork(network)) return USDC_BY_NETWORK[network]!;
  if (isKnownSolanaNetwork(network)) return getUsdcAddress(network as Network);
  throw new Error(`Unsupported x402 network: ${network}. Add USDC address to USDC_BY_NETWORK.`);
}

export function payToForNetwork(network: NetworkId, evmWallet: string, solanaWallet: string): string {
  if (isKnownSolanaNetwork(network)) {
    if (!solanaWallet) throw new Error(`SOLANA_WALLET_ADDRESS is required for ${network}`);
    return solanaWallet;
  }
  return evmWallet;
}

const USDC_EIP712_EXTRA: Record<string, { name: string; version: string }> = {
  'eip155:1': { name: 'USD Coin', version: '2' }
};

export function eip712ExtraForNetwork(network: NetworkId): { name: string; version: string } {
  try {
    const asset = getDefaultAsset(network);
    return { name: asset.name, version: asset.version };
  } catch {
    const extra = USDC_EIP712_EXTRA[network];
    if (!extra) {
      throw new Error(`No EIP-712 domain metadata for network ${network}`);
    }
    return extra;
  }
}

export function parseNetworkList(raw: string | undefined, fallback: NetworkId): NetworkId[] {
  const source = raw?.trim();
  if (!source) return [fallback];

  const seen = new Set<string>();
  const networks: NetworkId[] = [];

  for (const part of source.split(',')) {
    const id = part.trim() as NetworkId;
    if (!id || seen.has(id)) continue;
    if (!isKnownNetwork(id)) {
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
  evmPayTo: string,
  solanaPayTo: string,
  priceUsdc: number,
  maxTimeoutSeconds = 300
) {
  return networks.map((network) => {
    const base = {
      scheme: 'exact' as const,
      network,
      payTo: payToForNetwork(network, evmPayTo, solanaPayTo),
      price: {
        amount: String(Math.max(1, Math.round(priceUsdc * 1_000_000))),
        asset: usdcForNetwork(network)
      },
      maxTimeoutSeconds
    };
    if (!isKnownEvmNetwork(network)) return base;
    return {
      ...base,
      price: {
        ...base.price,
        extra: eip712ExtraForNetwork(network)
      }
    };
  });
}

export function filterNetworksForFacilitator(networks: NetworkId[]): NetworkId[] {
  const customFacilitator = Boolean(process.env.FACILITATOR_URL?.trim());
  const usesCdp = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && !customFacilitator);
  const solanaWallet = solanaWalletFromEnv();

  if (!usesCdp) {
    return networks.filter((n) => !isKnownSolanaNetwork(n) || Boolean(solanaWallet));
  }

  const allowed = new Set<string>([...CDP_SUPPORTED_EVM_NETWORKS, ...CDP_SUPPORTED_SOLANA_NETWORKS]);
  if (usesDualFacilitator()) {
    allowed.add('eip155:1');
  }

  const filtered = networks.filter((n) => {
    if (isKnownSolanaNetwork(n) && !solanaWallet) return false;
    return allowed.has(n);
  });
  const dropped = networks.filter((n) => !filtered.includes(n));

  if (dropped.length > 0) {
    console.warn(
      `[nodeproxy] Dropped unsupported networks: ${dropped.join(', ')}. ` +
        'Set SOLANA_WALLET_ADDRESS for Solana or FACILITATOR_URL for custom settlement.'
    );
  }

  const fallback = defaultMainnetNetworks(Boolean(ethereumL1FacilitatorUrl()));
  return filtered.length > 0 ? filtered : fallback;
}
