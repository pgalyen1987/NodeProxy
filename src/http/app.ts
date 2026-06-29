import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from '../config.js';
import {
  buildToolsManifest,
  buildWellKnownManifest,
  buildX402WellKnownManifest,
  buildAgentDiscoveryCard,
  buildMppWellKnownManifest,
  buildRobotsTxt
} from '../discovery/manifest.js';
import { cacheSnapshot } from '../lib/parseCache.js';
import { ensureX402Ready } from '../x402/payments.js';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { handleMcpHttpRequest } from '../mcp/http.js';
import { parseCapacitySnapshot } from '../lib/guards.js';
import { isMppEnabled, createStripeSpt } from '../mpp/server.js';
import { mppSnapshot } from '../mpp/config.js';
import { handleToolExecute } from './toolExecute.js';
import { createOpsRoutes } from '../billing/index.js';
import {
  TOOL_NAME,
  STEALTH_TOOL_NAME,
  TOOL_DESCRIPTION,
  STEALTH_TOOL_DESCRIPTION,
  priceLabel,
  stealthPriceLabel
} from '../tools.js';

const standardBazaar = declareDiscoveryExtension({
  toolName: TOOL_NAME,
  description: 'Fetch any URL, strip scripts/ads/nav, return compressed semantic Markdown for LLM ingestion.',
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Public website URL to parse' } },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://example.com\n\n# Title\n\nBody text...' }]
    }
  }
});

const stealthBazaar = declareDiscoveryExtension({
  toolName: STEALTH_TOOL_NAME,
  description:
    'Stealth anti-bot fetch with proxy rotation and CAPTCHA solving. Returns Markdown from Cloudflare/Akamai-protected pages.',
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Protected website URL to scrape' } },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://protected.example\n### RENDER: stealth\n\n# Title\n\nContent...' }]
    }
  }
});

export function createHttpApp() {
  const app = new Hono();
  app.use('*', cors());

  // Admin (/admin/*) + billing (/billing/*) routes for the non-crypto rail.
  app.route('/', createOpsRoutes());

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'nodeproxy',
      network: config.network,
      networks: config.networks,
      paymentMode: process.env.X402_PAYMENT_MODE || 'auto',
      currency: 'USDC',
      ethereumMainnetUsdc: config.networks.includes('eip155:1'),
      solanaMainnetUsdc: config.networks.includes('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
      wallets: {
        evm: config.walletAddress || null,
        solana: config.solanaWalletAddress || null
      },
      pricing: {
        standard: { tool: TOOL_NAME, priceUsdc: config.priceUsdc },
        stealth: { tool: STEALTH_TOOL_NAME, priceUsdc: config.stealth.priceUsdc }
      },
      capacity: parseCapacitySnapshot(),
      cache: cacheSnapshot(),
      renderEngine: config.renderEngine,
      playwright: config.renderEngine !== 'jsdom',
      stealth: {
        proxyConfigured: config.stealth.proxyUrls.length > 0,
        captchaSolver: config.stealth.captchaSolverProvider,
        maxConcurrent: config.stealth.maxConcurrentParses
      },
      mpp: mppSnapshot(config.mpp)
    })
  );

  app.get('/.well-known/mcp.json', (c) => c.json(buildWellKnownManifest()));
  app.get('/.well-known/x402.json', (c) => c.json(buildX402WellKnownManifest()));
  if (isMppEnabled()) {
    app.get('/.well-known/mpp.json', (c) => c.json(buildMppWellKnownManifest()));
  }
  app.get('/discovery/manifest.json', (c) => c.json(buildToolsManifest()));
  app.get('/discovery/agent.json', (c) => c.json(buildAgentDiscoveryCard()));
  app.get('/robots.txt', (c) => c.text(buildRobotsTxt(), 200, { 'Content-Type': 'text/plain; charset=utf-8' }));

  app.get('/mcp/tools', (c) => {
    const manifest = buildToolsManifest();
    return c.json({ tools: manifest.tools });
  });

  app.get('/registry/server.json', (c) => c.json(buildToolsManifest()));

  app.all('/mcp', async (c) => handleMcpHttpRequest(c.req.raw));

  app.post('/mpp/stripe/create-token', async (c) => {
    if (!isMppEnabled()) {
      return c.json({ error: 'MPP Stripe is not configured' }, 503);
    }
    let body: {
      payment_method?: string;
      amount?: string;
      currency?: string;
      networkId?: string;
      expiresAt?: number;
      metadata?: Record<string, string>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!body.payment_method) {
      return c.json({ error: 'payment_method is required' }, 400);
    }
    try {
      return c.json(
        await createStripeSpt({
          payment_method: body.payment_method,
          amount: body.amount,
          currency: body.currency,
          networkId: body.networkId,
          expiresAt: body.expiresAt,
          metadata: body.metadata
        })
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to create SPT' },
        502
      );
    }
  });

  app.post('/mcp/execute', async (c) => {
    try {
      let body: {
        tool?: string;
        arguments?: { url?: string };
        paymentNetwork?: string;
        payerAddress?: string;
        paymentOptions?: string;
        network?: string;
      };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const tool = body.tool || TOOL_NAME;
      if (tool !== TOOL_NAME && tool !== STEALTH_TOOL_NAME) {
        return c.json(
          {
            error: 'Unknown tool',
            hint: `Use "${TOOL_NAME}" or "${STEALTH_TOOL_NAME}"`,
            tools: {
              [TOOL_NAME]: { endpoint: '/mcp/execute', priceUsdc: config.priceUsdc },
              [STEALTH_TOOL_NAME]: { endpoint: '/stealth-scrape', priceUsdc: config.stealth.priceUsdc }
            }
          },
          400
        );
      }

      const resourcePath = tool === STEALTH_TOOL_NAME ? '/stealth-scrape' : '/mcp/execute';
      return handleToolExecute(c, body, {
        tool,
        resourcePath,
        bazaarExtensions: tool === STEALTH_TOOL_NAME ? stealthBazaar : standardBazaar,
        allowMpp: tool === TOOL_NAME
      });
    } catch (err) {
      console.error('[mcp/execute]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  app.post('/stealth-scrape', async (c) => {
    try {
      let body: { url?: string; arguments?: { url?: string } };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const url = body.url || body.arguments?.url;
      return handleToolExecute(
        c,
        { arguments: { url } },
        {
          tool: STEALTH_TOOL_NAME,
          resourcePath: '/stealth-scrape',
          bazaarExtensions: stealthBazaar,
          allowMpp: false
        }
      );
    } catch (err) {
      console.error('[stealth-scrape]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  void ensureX402Ready();

  return app;
}

export { TOOL_NAME, STEALTH_TOOL_NAME, TOOL_DESCRIPTION, STEALTH_TOOL_DESCRIPTION, priceLabel, stealthPriceLabel };
