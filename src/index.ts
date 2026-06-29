import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createHttpApp } from './http/app.js';
import { ensureX402Ready } from './x402/payments.js';
import { closePlaywrightBrowser } from './parser/playwrightFetch.js';
import { closeStealthBrowser } from './parser/stealthFetch.js';
import { closeParseCache } from './lib/parseCache.js';

async function main() {
  if (!config.walletAddress) {
    console.warn('[nodeproxy] WALLET_ADDRESS is unset — set it before production deploy');
  }

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
