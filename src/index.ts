import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createHttpApp } from './http/app.js';
import { ensureX402Ready } from './x402/payments.js';

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
      console.log(`  Price:         ${config.priceUsdc} USDC → ${config.walletAddress || '(unset)'}`);
      console.log(`  Networks:      ${config.networks.join(', ')}`);
    }
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
