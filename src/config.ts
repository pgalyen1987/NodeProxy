import {
  defaultMainnetNetworks,
  filterNetworksForFacilitator,
  networkLabel,
  parseNetworkList,
  usdcForNetwork
} from './x402/networks.js';
import { ethereumL1FacilitatorUrl } from './x402/facilitators.js';

export type NetworkId = `eip155:${number}` | `solana:${string}`;

export const TOOL_NAME = 'surface_markdown_parser' as const;

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion.';

export interface NetworkPaymentConfig {
  network: NetworkId;
  asset: string;
  label: string;
}

export interface AppConfig {
  port: number;
  host: string;
  publicUrl: string;
  walletAddress: string;
  priceUsdc: number;
  /** Primary network (first in `networks`) for backwards-compatible fields. */
  network: NetworkId;
  /** All accepted x402 payment networks. */
  networks: NetworkId[];
  networkPayments: NetworkPaymentConfig[];
  facilitatorUrl: string;
  /** USDC on the primary network. */
  usdcBase: string;
  serviceName: string;
  serviceTags: string[];
  maxConcurrentParses: number;
  rateLimitPerMinute: number;
  maxHtmlBytes: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function resolvePublicUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.RAILWAY_STATIC_URL) return process.env.RAILWAY_STATIC_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || '4022'}`;
}

function resolveFacilitatorUrl(networks: NetworkId[]): string {
  if (process.env.FACILITATOR_URL) return process.env.FACILITATOR_URL;

  const hasCdpMainnet = networks.some(
    (n) => n === 'eip155:8453' || n === 'eip155:137' || n === 'eip155:42161' || n === 'eip155:480'
  );
  const hasCdpKeys = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);

  if (hasCdpMainnet && hasCdpKeys) {
    return 'https://api.cdp.coinbase.com/platform/v2/x402';
  }

  return 'https://x402.org/facilitator';
}

function resolveNetworks(): NetworkId[] {
  if (process.env.X402_NETWORKS?.trim()) {
    const fallback = (process.env.X402_NETWORK || 'eip155:84532') as NetworkId;
    return parseNetworkList(process.env.X402_NETWORKS, fallback);
  }

  const single = (process.env.X402_NETWORK || 'eip155:84532') as NetworkId;
  if (single === 'eip155:8453') {
    return defaultMainnetNetworks(Boolean(ethereumL1FacilitatorUrl()));
  }

  return [single];
}

const networks = filterNetworksForFacilitator(resolveNetworks());
const networkPayments: NetworkPaymentConfig[] = networks.map((network) => ({
  network,
  asset: usdcForNetwork(network),
  label: networkLabel(network)
}));

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '4022', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: resolvePublicUrl(),
  walletAddress: process.env.WALLET_ADDRESS || '',
  priceUsdc: envFloat('PRICE_USDC', 0.002),
  network: networks[0],
  networks,
  networkPayments,
  facilitatorUrl: resolveFacilitatorUrl(networks),
  usdcBase: networkPayments[0]?.asset || '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  serviceName: process.env.SERVICE_NAME || 'nodeproxy',
  serviceTags: (process.env.SERVICE_TAGS || 'web,scrape,markdown,llm,parser,mcp,x402').split(','),
  maxConcurrentParses: envInt('MAX_CONCURRENT_PARSES', 20),
  rateLimitPerMinute: envInt('RATE_LIMIT_PER_MINUTE', 120),
  maxHtmlBytes: envInt('MAX_HTML_BYTES', 5_242_880)
};

export function priceLabel(): string {
  return `$${config.priceUsdc.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}
