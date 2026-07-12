import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createHttpApp } from './http/app.js';
import { ensureX402Ready } from './x402/payments.js';
import { closePlaywrightBrowser } from './parser/playwrightFetch.js';
import { closeStealthBrowser } from './parser/stealthFetch.js';
import { closeParseCache } from './lib/parseCache.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Fail-closed guard that a real EVM payout wallet is configured. In production an
 * unset, zero (burn), or malformed WALLET_ADDRESS throws — so USDC is never
 * settled to an unrecoverable address; in dev it warns. Skipped when no EVM
 * (eip155:*) network is quoted.
 */
function assertWalletConfigured(): void {
  const hasEvmNetwork = config.networks.some((n) => String(n).startsWith('eip155:'));
  if (!hasEvmNetwork) return;

  const evm = (config.walletAddress || '').trim();
  const reason = !evm
    ? 'unset'
    : evm.toLowerCase() === ZERO_ADDRESS
      ? 'the zero (burn) address'
      : !EVM_ADDRESS_RE.test(evm)
        ? 'not a valid EVM address'
        : null;
  if (!reason) return;

  const msg = `nodeproxy: WALLET_ADDRESS is ${reason} — USDC would be lost, refusing to serve paid requests`;
  if (process.env.NODE_ENV === 'production') throw new Error(msg);
  console.warn(`[nodeproxy] ${msg} (continuing in dev)`);
}

async function main() {
  assertWalletConfigured();

  await ensureX402Ready();
  const app = createHttpApp();

  serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host
    },
    (info) => {
      const base = config.publicUrl.includes('localhost') ? `http://${info.address}:${info.port}` : config.publicUrl;
      console.log(`NodeProxy listening on http://${info.address}:${info.port}`);
      console.log(`  MCP tools:     ${base}/mcp/tools`);
      console.log(`  MCP execute:   ${base}/mcp/execute`);
      console.log(`  MCP transport: ${base}/mcp`);
      console.log(`  Registry JSON: ${base}/registry/server.json`);
      console.log(`  Stealth scrape: ${base}/stealth-scrape`);
      console.log(`  Price:         ${config.priceUsdc} USDC (standard) / ${config.stealth.priceUsdc} USDC (stealth)`);
      console.log(`  Wallet (EVM):  ${config.walletAddress || '(unset)'}`);
      console.log(`  Wallet (SOL):  ${config.solanaWalletAddress || '(unset)'}`);
      console.log(`  Networks:      ${config.networks.join(', ')}`);
    }
  );

  const shutdown = async () => {
    await Promise.all([closePlaywrightBrowser(), closeStealthBrowser(), closeParseCache()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
