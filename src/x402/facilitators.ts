import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import { createFacilitatorConfig } from '@coinbase/x402';

export const DEFAULT_ETHEREUM_L1_FACILITATOR_URL = 'https://facilitator.primev.xyz';

export function ethereumL1FacilitatorUrl(): string | undefined {
  if (process.env.X402_INCLUDE_ETHEREUM_L1 === '0') return undefined;
  const custom = process.env.ETHEREUM_L1_FACILITATOR_URL?.trim();
  if (custom) return custom;
  if (process.env.X402_INCLUDE_ETHEREUM_L1 === '1') return DEFAULT_ETHEREUM_L1_FACILITATOR_URL;
  // Default on production CDP setups — Primev settles Ethereum mainnet USDC.
  if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && !process.env.FACILITATOR_URL?.trim()) {
    return DEFAULT_ETHEREUM_L1_FACILITATOR_URL;
  }
  return undefined;
}

export function usesDualFacilitator(): boolean {
  return Boolean(
    ethereumL1FacilitatorUrl() &&
      process.env.CDP_API_KEY_ID &&
      process.env.CDP_API_KEY_SECRET &&
      !process.env.FACILITATOR_URL?.trim()
  );
}

export function buildFacilitatorClients(fallbackUrl: string): FacilitatorClient | FacilitatorClient[] {
  const customUrl = process.env.FACILITATOR_URL?.trim();
  if (customUrl) {
    return new HTTPFacilitatorClient({ url: customUrl });
  }

  const cdpId = process.env.CDP_API_KEY_ID;
  const cdpSecret = process.env.CDP_API_KEY_SECRET;
  const l1Url = ethereumL1FacilitatorUrl();

  if (cdpId && cdpSecret) {
    const clients: FacilitatorClient[] = [
      new HTTPFacilitatorClient(createFacilitatorConfig(cdpId, cdpSecret))
    ];
    if (l1Url) {
      clients.push(new HTTPFacilitatorClient({ url: l1Url }));
    }
    return clients.length === 1 ? clients[0]! : clients;
  }

  return new HTTPFacilitatorClient({ url: fallbackUrl });
}
