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
import { handleTimerCreate, handleTimerPoll } from '../timer/handler.js';
import { startTimerScheduler } from '../timer/scheduler.js';
import { handleInboxCreate, handleInboxIngest, handleInboxPoll } from '../agentkit/inbox.js';
import { handleLock } from '../agentkit/lock.js';
import { handleSecret } from '../agentkit/secret.js';
import { emitChallenge } from '../agentkit/pay.js';
import {
  TOOL_NAME,
  STEALTH_TOOL_NAME,
  TIMER_TOOL_NAME,
  INBOX_TOOL_NAME,
  LOCK_TOOL_NAME,
  SECRET_TOOL_NAME,
  TOOL_DESCRIPTION,
  TIMER_TOOL_DESCRIPTION,
  INBOX_TOOL_DESCRIPTION,
  LOCK_TOOL_DESCRIPTION,
  SECRET_TOOL_DESCRIPTION,
  stealthToolDescription,
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
  description: stealthToolDescription(),
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Website URL to fetch via the hardened headless browser' } },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://protected.example\n### RENDER: stealth\n\n# Title\n\nContent...' }]
    }
  }
});

const timerBazaar = declareDiscoveryExtension({
  toolName: TIMER_TOOL_NAME,
  description: TIMER_TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: {
      delay_seconds: { type: 'number', description: 'Seconds from now to fire (preferred).' },
      fire_at: { type: 'number', description: 'Absolute fire time as epoch seconds (alternative to delay_seconds).' },
      action: {
        type: 'object',
        description: 'Execute this HTTP request at fire time and capture the response for polling.',
        properties: {
          url: { type: 'string', description: 'Public HTTPS URL to call.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method (default POST).' },
          headers: { type: 'object', description: 'Optional request headers.' },
          body: { description: 'Optional JSON request body.' }
        },
        required: ['url']
      },
      callback_url: { type: 'string', description: 'HTTPS URL to POST the payload (or action result) to at fire time (push). Omit for poll.' },
      payload: { description: 'Arbitrary JSON delivered/held verbatim at fire time (when no action is given).' },
      mode: { type: 'string', enum: ['push', 'poll'], description: 'For payload timers: push = POST to callback_url; poll = retrieve via GET /agent-timer/{id}.' }
    },
    required: []
  },
  output: {
    example: {
      timer: { id: 'b1f2…', kind: 'action', fire_at: 1751240000, status: 'pending', poll_url: 'https://…/agent-timer/b1f2…' }
    }
  }
});

const inboxBazaar = declareDiscoveryExtension({
  toolName: INBOX_TOOL_NAME,
  description: INBOX_TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: { type: 'object', properties: {}, required: [] },
  output: {
    example: { inbox: { id: 'a1…', ingest_url: 'https://…/agent-inbox/a1…/in', poll_url: 'https://…/agent-inbox/a1…' } }
  }
});

const lockBazaar = declareDiscoveryExtension({
  toolName: LOCK_TOOL_NAME,
  description: LOCK_TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['claim', 'release', 'check'], description: 'Lock operation.' },
      key: { type: 'string', description: 'Lock key (the work item identifier).' },
      ttl_seconds: { type: 'number', description: 'Lease length for claim.' },
      token: { type: 'string', description: 'Token from claim, required for release.' }
    },
    required: ['key']
  },
  output: { example: { lock: { op: 'claim', key: 'job:42', acquired: true, token: 'c3…' } } }
});

const secretBazaar = declareDiscoveryExtension({
  toolName: SECRET_TOOL_NAME,
  description: SECRET_TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['store', 'redeem'], description: 'store a secret or redeem-and-burn one.' },
      secret: { type: 'string', description: 'Secret value to store.' },
      ttl_seconds: { type: 'number', description: 'Expiry for stored secret.' },
      token: { type: 'string', description: 'Token from store, required for redeem.' }
    },
    required: []
  },
  output: { example: { secret: { op: 'store', token: 'd4…', expires_in: 3600 } } }
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

  app.post('/agent-timer', async (c) => {
    try {
      return await handleTimerCreate(c, timerBazaar);
    } catch (err) {
      console.error('[agent-timer]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  app.get('/agent-timer/:id', async (c) => {
    try {
      return await handleTimerPoll(c);
    } catch (err) {
      console.error('[agent-timer/:id]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  // --- Agent inbox (capture external pushes → pollable) ---
  app.post('/agent-inbox', async (c) => {
    try {
      return await handleInboxCreate(c, inboxBazaar);
    } catch (err) {
      console.error('[agent-inbox]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });
  app.post('/agent-inbox/:id/in', async (c) => handleInboxIngest(c));
  app.get('/agent-inbox/:id', async (c) => handleInboxPoll(c));

  // --- Agent lock / idempotency ---
  app.post('/agent-lock', async (c) => {
    try {
      return await handleLock(c, lockBazaar);
    } catch (err) {
      console.error('[agent-lock]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  // --- Agent one-time secret relay ---
  app.post('/agent-secret', async (c) => {
    try {
      return await handleSecret(c, secretBazaar);
    } catch (err) {
      console.error('[agent-secret]', err);
      return c.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, 500);
    }
  });

  // --- GET discovery probes: return the x402 challenge instead of 404/405 so a
  //     Bazaar crawler hitting the resource URL gets a valid 402 + extension. ---
  app.get('/mcp/execute', (c) => emitChallenge(c, { tool: TOOL_NAME, resourcePath: '/mcp/execute', bazaar: standardBazaar }));
  app.get('/stealth-scrape', (c) => emitChallenge(c, { tool: STEALTH_TOOL_NAME, resourcePath: '/stealth-scrape', bazaar: stealthBazaar }));
  app.get('/agent-timer', (c) => emitChallenge(c, { tool: TIMER_TOOL_NAME, resourcePath: '/agent-timer', bazaar: timerBazaar }));
  app.get('/agent-lock', (c) => emitChallenge(c, { tool: LOCK_TOOL_NAME, resourcePath: '/agent-lock', bazaar: lockBazaar }));
  app.get('/agent-secret', (c) => emitChallenge(c, { tool: SECRET_TOOL_NAME, resourcePath: '/agent-secret', bazaar: secretBazaar }));

  void ensureX402Ready();
  startTimerScheduler();

  return app;
}

export { TOOL_NAME, STEALTH_TOOL_NAME, TOOL_DESCRIPTION, priceLabel, stealthPriceLabel };
