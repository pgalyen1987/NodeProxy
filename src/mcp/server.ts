import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPaymentWrapper } from '@x402/mcp';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { z } from 'zod';
import { config } from '../config.js';
import { UrlSafetyError } from '../parser/surface.js';
import { resolveSurfaceMarkdown } from '../parser/resolve.js';
import { resolveStealthMarkdown } from '../parser/stealthResolve.js';
import { StealthBlockedError } from '../parser/stealthSurface.js';
import { ensureX402Ready, resourceServer } from '../x402/payments.js';
import { networkPaymentOptions } from '../x402/networks.js';
import { resolvePayment } from '../x402/negotiate.js';
import {
  TOOL_NAME,
  STEALTH_TOOL_NAME,
  TOOL_DESCRIPTION,
  stealthToolDescription,
  priceLabel,
  stealthPriceLabel
} from '../tools.js';

async function buildAccepts(priceUsdc: number) {
  await ensureX402Ready();
  const resolved = await resolvePayment({ mode: 'auto' }, priceUsdc);
  return resourceServer.buildPaymentRequirementsFromOptions(
    networkPaymentOptions(
      [resolved.network],
      config.walletAddress || '0x0000000000000000000000000000000000000000',
      config.solanaWalletAddress,
      priceUsdc
    ),
    {}
  );
}

const standardBazaar = declareDiscoveryExtension({
  toolName: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Public website URL to parse into Markdown' } },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://example.com\n\n# Page Title\n\nContent...' }]
    }
  }
});

const stealthBazaar = declareDiscoveryExtension({
  toolName: STEALTH_TOOL_NAME,
  description: stealthToolDescription(),
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Protected URL for stealth Markdown extraction' } },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://protected.example\n### RENDER: stealth\n\n# Title\n\n...' }]
    }
  }
});

export async function createMcpServer(): Promise<McpServer> {
  const [standardAccepts, stealthAccepts] = await Promise.all([
    buildAccepts(config.priceUsdc),
    buildAccepts(config.stealth.priceUsdc)
  ]);

  const standardPaid = createPaymentWrapper(resourceServer, {
    accepts: standardAccepts,
    resource: {
      url: `mcp://tool/${TOOL_NAME}`,
      description: TOOL_DESCRIPTION,
      mimeType: 'application/json',
      serviceName: config.serviceName,
      tags: config.serviceTags
    },
    extensions: standardBazaar
  });

  const stealthPaid = createPaymentWrapper(resourceServer, {
    accepts: stealthAccepts,
    resource: {
      url: `mcp://tool/${STEALTH_TOOL_NAME}`,
      description: stealthToolDescription(),
      mimeType: 'application/json',
      serviceName: config.serviceName,
      tags: [...config.serviceTags, 'stealth', 'anti-bot']
    },
    extensions: stealthBazaar
  });

  const server = new McpServer(
    {
      name: config.serviceName,
      version: '1.1.0'
    },
    {
      capabilities: { tools: {} },
      instructions:
        `Paid x402 web surface parser. Tools:\n` +
        `- ${TOOL_NAME}: ${priceLabel()} USDC — fast public page Markdown\n` +
        `- ${STEALTH_TOOL_NAME}: ${stealthPriceLabel()} USDC — hardened headless-browser fetch (full JS/SPA rendering)\n` +
        `Networks: ${config.networks.join(', ')}`
    }
  );

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Web Surface Markdown Parser',
      description: `${TOOL_DESCRIPTION} Price: ${priceLabel()} USDC per call.`,
      inputSchema: { url: z.string().url().describe('Public http(s) URL to fetch and convert') }
    },
    standardPaid(async ({ url }) => {
      try {
        const { markdown, bytes, cache, render, stealthHint } = await resolveSurfaceMarkdown(url);
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: { source: url, bytes, cache, render, ...(stealthHint ? { stealthHint } : {}) }
        };
      } catch (err) {
        const message = err instanceof UrlSafetyError ? err.message : err instanceof Error ? err.message : 'Parse failed';
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    })
  );

  server.registerTool(
    STEALTH_TOOL_NAME,
    {
      title: 'Stealth Anti-Bot Markdown Parser',
      description: `${stealthToolDescription()} Price: ${stealthPriceLabel()} USDC per call.`,
      inputSchema: { url: z.string().url().describe('Protected http(s) URL to fetch via stealth pipeline') }
    },
    stealthPaid(async ({ url }) => {
      try {
        const { markdown, bytes, cache, render, proxyUsed, captchaSolved, attempts } =
          await resolveStealthMarkdown(url);
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: { source: url, bytes, cache, render, proxyUsed, captchaSolved, attempts }
        };
      } catch (err) {
        const message =
          err instanceof UrlSafetyError || err instanceof StealthBlockedError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Stealth parse failed';
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    })
  );

  return server;
}
