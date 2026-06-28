import type { HTTPRequestContext } from '@x402/core/server';
import { config, type NetworkId } from '../config.js';
import { isKnownEvmNetwork, networkLabel, usdcForNetwork } from './networks.js';

export type PaymentSelectionSource = 'explicit' | 'payer-balance' | 'default';
export type PaymentMode = 'auto' | 'all';

export interface PaymentHints {
  mode: PaymentMode;
  preferredNetwork?: NetworkId;
  payerAddress?: string;
}

export interface ResolvedPayment {
  network: NetworkId;
  currency: 'USDC';
  asset: string;
  amountUsdc: number;
  label: string;
  selection: PaymentSelectionSource;
  alternatives: NetworkId[];
}

const RPC_BY_NETWORK: Partial<Record<NetworkId, string>> = {
  'eip155:8453': 'https://mainnet.base.org',
  'eip155:84532': 'https://sepolia.base.org',
  'eip155:137': 'https://polygon-rpc.com',
  'eip155:42161': 'https://arb1.arbitrum.io/rpc',
  'eip155:1': 'https://cloudflare-eth.com',
  'eip155:10': 'https://mainnet.optimism.io'
};

function paymentModeFromEnv(): PaymentMode {
  const raw = (process.env.X402_PAYMENT_MODE || 'auto').toLowerCase();
  return raw === 'all' ? 'all' : 'auto';
}

function header(context: HTTPRequestContext, name: string): string | undefined {
  const direct = context.adapter.getHeader(name);
  if (direct) return direct;

  const lower = name.toLowerCase();
  const fromLower = context.adapter.getHeader(lower);
  if (fromLower) return fromLower;

  const titled = lower.replace(/(^|-)(\w)/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
  return context.adapter.getHeader(titled);
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeNetwork(value: string | undefined): NetworkId | undefined {
  if (!value) return undefined;
  const id = value.trim() as NetworkId;
  if (!isKnownEvmNetwork(id)) return undefined;
  if (!config.networks.includes(id)) return undefined;
  return id;
}

export function parsePaymentHints(
  context: HTTPRequestContext,
  body?: Record<string, unknown>
): PaymentHints {
  const headerMode = header(context, 'x-payment-options')?.toLowerCase();
  const mode: PaymentMode =
    headerMode === 'all' || body?.paymentOptions === 'all' ? 'all' : paymentModeFromEnv();

  const preferredNetwork =
    normalizeNetwork(header(context, 'x-payment-network')) ||
    normalizeNetwork(header(context, 'payment-network')) ||
    normalizeNetwork(typeof body?.paymentNetwork === 'string' ? body.paymentNetwork : undefined) ||
    normalizeNetwork(typeof body?.network === 'string' ? body.network : undefined);

  const payerAddress =
    normalizeAddress(header(context, 'x-payer-address')) ||
    normalizeAddress(typeof body?.payerAddress === 'string' ? body.payerAddress : undefined);

  return { mode, preferredNetwork, payerAddress };
}

async function usdcBalanceAtomic(network: NetworkId, wallet: string): Promise<bigint> {
  const rpc = RPC_BY_NETWORK[network];
  if (!rpc) return 0n;

  const usdc = usdcForNetwork(network);
  const data = `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}`;

  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: usdc, data }, 'latest']
    }),
    signal: AbortSignal.timeout(4000)
  });

  if (!res.ok) return 0n;
  const json = (await res.json()) as { result?: string };
  if (!json.result || json.result === '0x') return 0n;
  return BigInt(json.result);
}

async function pickNetworkByPayerBalance(
  payerAddress: string,
  minUsdc: number
): Promise<NetworkId | undefined> {
  const minAtomic = BigInt(Math.ceil(minUsdc * 1_000_000));
  const probeEnabled = (process.env.X402_AUTO_NETWORK ?? '1') !== '0';

  if (!probeEnabled) return undefined;

  for (const network of config.networks) {
    try {
      const balance = await usdcBalanceAtomic(network, payerAddress);
      if (balance >= minAtomic) return network;
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function resolvePayment(hints: PaymentHints): Promise<ResolvedPayment> {
  const alternatives = [...config.networks];
  let network = config.network;
  let selection: PaymentSelectionSource = 'default';

  if (hints.preferredNetwork) {
    network = hints.preferredNetwork;
    selection = 'explicit';
  } else if (hints.payerAddress) {
    const fromBalance = await pickNetworkByPayerBalance(hints.payerAddress, config.priceUsdc);
    if (fromBalance) {
      network = fromBalance;
      selection = 'payer-balance';
    }
  }

  return {
    network,
    currency: 'USDC',
    asset: usdcForNetwork(network),
    amountUsdc: config.priceUsdc,
    label: networkLabel(network),
    selection,
    alternatives: alternatives.filter((n) => n !== network)
  };
}

export function toPaymentSummary(resolved: ResolvedPayment) {
  return {
    network: resolved.network,
    label: resolved.label,
    currency: resolved.currency,
    asset: resolved.asset,
    amountUsdc: resolved.amountUsdc,
    selection: resolved.selection,
    alternatives: resolved.alternatives
  };
}
