import { buildMppConfig, type MppConfig } from './mpp/config.js';
import {
  defaultMainnetNetworks,
  filterNetworksForFacilitator,
  networkLabel,
  parseNetworkList,
  payToForNetwork,
  solanaWalletFromEnv,
  usdcForNetwork
} from './x402/networks.js';
import { ethereumL1FacilitatorUrl } from './x402/facilitators.js';

export type NetworkId = `eip155:${number}` | `solana:${string}`;

export interface StealthConfig {
  priceUsdc: number;
  maxConcurrentParses: number;
  playwrightWaitMs: number;
  playwrightTimeoutMs: number;
  proxyUrls: string[];
  userAgent: string;
  captchaSolverKey: string;
  captchaSolverProvider: '2captcha' | 'none';
  maxFetchAttempts: number;
}

export interface NetworkPaymentConfig {
  network: NetworkId;
  asset: string;
  label: string;
  payTo: string;
}

export interface AppConfig {
  port: number;
  host: string;
  publicUrl: string;
  walletAddress: string;
  solanaWalletAddress: string;
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
  redisUrl: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  cacheMaxEntries: number;
  renderEngine: 'auto' | 'jsdom' | 'playwright';
  playwrightMinText: number;
  playwrightWaitMs: number;
  playwrightTimeoutMs: number;
  mpp: MppConfig;
  stealth: StealthConfig;
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
    (n) =>
      n === 'eip155:8453' ||
      n === 'eip155:137' ||
      n === 'eip155:42161' ||
      n === 'eip155:480' ||
      n === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
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

function envRenderEngine(): 'auto' | 'jsdom' | 'playwright' {
  const raw = (process.env.RENDER_ENGINE || 'auto').toLowerCase();
  if (raw === 'jsdom' || raw === 'playwright') return raw;
  return 'auto';
}

function parseProxyList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const networks = filterNetworksForFacilitator(resolveNetworks());
const evmWallet = process.env.WALLET_ADDRESS || '';
const solanaWallet = solanaWalletFromEnv();
const networkPayments: NetworkPaymentConfig[] = networks.map((network) => ({
  network,
  asset: usdcForNetwork(network),
  label: networkLabel(network),
  payTo: payToForNetwork(network, evmWallet, solanaWallet)
}));
const publicUrl = resolvePublicUrl();

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '4022', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl,
  walletAddress: evmWallet,
  solanaWalletAddress: solanaWallet,
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
  maxHtmlBytes: envInt('MAX_HTML_BYTES', 5_242_880),
  redisUrl: process.env.REDIS_URL?.trim() || '',
  cacheEnabled: (process.env.CACHE_ENABLED ?? '1') !== '0',
  cacheTtlSeconds: envInt('CACHE_TTL_SECONDS', 600),
  cacheMaxEntries: envInt('CACHE_MAX_ENTRIES', 10),
  renderEngine: envRenderEngine(),
  playwrightMinText: envInt('PLAYWRIGHT_MIN_TEXT', 200),
  playwrightWaitMs: envInt('PLAYWRIGHT_WAIT_MS', 2500),
  playwrightTimeoutMs: envInt('PLAYWRIGHT_TIMEOUT_MS', 30_000),
  mpp: buildMppConfig(publicUrl),
  stealth: {
    priceUsdc: envFloat('STEALTH_PRICE_USDC', 0.05),
    maxConcurrentParses: envInt('STEALTH_MAX_CONCURRENT', 5),
    playwrightWaitMs: envInt('STEALTH_PLAYWRIGHT_WAIT_MS', 5000),
    playwrightTimeoutMs: envInt('STEALTH_PLAYWRIGHT_TIMEOUT_MS', 60_000),
    proxyUrls: parseProxyList(process.env.STEALTH_PROXY_URLS || process.env.STEALTH_PROXY_URL),
    userAgent:
      process.env.STEALTH_USER_AGENT?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    captchaSolverKey: process.env.CAPTCHA_SOLVER_KEY?.trim() || process.env.TWO_CAPTCHA_KEY?.trim() || '',
    captchaSolverProvider: process.env.CAPTCHA_SOLVER_KEY || process.env.TWO_CAPTCHA_KEY ? '2captcha' : 'none',
    maxFetchAttempts: envInt('STEALTH_MAX_ATTEMPTS', 2)
  }
};

/** @deprecated use priceLabel from tools.ts */
export function priceLabel(): string {
  return `$${config.priceUsdc.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}
