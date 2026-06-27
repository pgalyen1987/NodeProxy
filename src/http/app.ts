import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config, TOOL_NAME } from '../config.js';
import { buildToolsManifest, buildWellKnownManifest } from '../discovery/manifest.js';
import { parseSurface, UrlSafetyError } from '../parser/surface.js';
import {
  consumeProof,
  createToolPaymentChallenge,
  encodePaymentRequiredHeader,
  ensureX402Ready,
  releaseProof,
  verifyAndSettleToolPayment
} from '../x402/payments.js';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { buildRequestContext } from './context.js';
import { handleMcpHttpRequest } from '../mcp/http.js';
import { ConcurrencyError, isRateLimited, parseCapacitySnapshot, rateLimitKey } from '../lib/guards.js';

const bazaarExtensions = declareDiscoveryExtension({
  toolName: TOOL_NAME,
  description:
    'Fetch any URL, strip scripts/ads/nav, return compressed semantic Markdown for LLM ingestion.',
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public website URL to parse' }
    },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://example.com\n\n# Title\n\nBody text...' }]
    }
  }
});

export function createHttpApp() {
  const app = new Hono();
  app.use('*', cors());

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'nodeproxy',
      network: config.network,
      priceUsdc: config.priceUsdc,
      capacity: parseCapacitySnapshot()
    })
  );

  app.get('/.well-known/mcp.json', (c) => c.json(buildWellKnownManifest()));
  app.get('/discovery/manifest.json', (c) => c.json(buildToolsManifest()));

  app.get('/mcp/tools', (c) => {
    const manifest = buildToolsManifest();
    return c.json({ tools: manifest.tools });
  });

  app.get('/registry/server.json', (c) => c.json(buildToolsManifest()));

  app.all('/mcp', async (c) => {
    return handleMcpHttpRequest(c.req.raw);
  });

  app.post('/mcp/execute', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
    if (isRateLimited(rateLimitKey(ip, c.req.header('user-agent') || 'anon'))) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await ensureX402Ready();

    let body: { tool?: string; arguments?: { url?: string } };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (body.tool !== TOOL_NAME || !body.arguments?.url) {
      return c.json({ error: 'Invalid tool routing parameters.' }, 400);
    }

    const context = buildRequestContext(c);
    const resourceUrl = `${config.publicUrl}/mcp/execute`;
    const signature = c.req.header('payment-signature') || c.req.header('PAYMENT-SIGNATURE');

    if (!signature) {
      const { paymentRequired } = await createToolPaymentChallenge(context, resourceUrl, bazaarExtensions);
      return c.json(
        {
          error: 'Payment Required',
          message: 'Valid x402 PAYMENT-SIGNATURE required.',
          x402: paymentRequired
        },
        402,
        { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired) }
      );
    }

    if (!consumeProof(signature)) {
      return c.json({ error: 'Payment proof already consumed' }, 409);
    }

    const { requirements } = await createToolPaymentChallenge(context, resourceUrl, bazaarExtensions);
    const settled = await verifyAndSettleToolPayment(context, signature, requirements);

    if (!settled.ok) {
      releaseProof(signature);
      return c.json({ error: settled.message }, settled.status as 401 | 402);
    }

    try {
      const { markdown } = await parseSurface(body.arguments.url);
      const headers: Record<string, string> = { ...settled.headers };
      return c.json(
        {
          content: [{ type: 'text', text: markdown }],
          settlement: { transaction: settled.transaction, network: config.network }
        },
        200,
        headers
      );
    } catch (err) {
      releaseProof(signature);
      if (err instanceof UrlSafetyError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof ConcurrencyError) {
        return c.json({ error: err.message }, 503);
      }
      return c.json(
        { error: err instanceof Error ? err.message : 'Parse failed' },
        502
      );
    }
  });

  return app;
}
