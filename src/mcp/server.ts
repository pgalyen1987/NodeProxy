import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPaymentWrapper } from '@x402/mcp';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { z } from 'zod';
import { config, priceLabel, TOOL_DESCRIPTION, TOOL_NAME } from '../config.js';
import { UrlSafetyError } from '../parser/surface.js';
import { resolveSurfaceMarkdown } from '../parser/resolve.js';
import { ensureX402Ready, resourceServer } from '../x402/payments.js';
import { networkPaymentOptions } from '../x402/networks.js';
import { resolvePayment } from '../x402/negotiate.js';

let acceptsCache: Awaited<ReturnType<typeof resourceServer.buildPaymentRequirementsFromOptions>> | null = null;

async function getAccepts() {
  if (!acceptsCache) {
    await ensureX402Ready();
    const resolved = await resolvePayment({ mode: 'auto' });
    acceptsCache = await resourceServer.buildPaymentRequirementsFromOptions(
      networkPaymentOptions(
        [resolved.network],
        config.walletAddress || '0x0000000000000000000000000000000000000000',
        config.priceUsdc
      ),
      {}
    );
  }
  return acceptsCache;
}

const bazaarExtensions = declareDiscoveryExtension({
  toolName: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  transport: 'streamable-http',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public website URL to parse into Markdown' }
    },
    required: ['url']
  },
  output: {
    example: {
      content: [{ type: 'text', text: '### SOURCE: https://example.com\n\n# Page Title\n\nContent...' }]
    }
  }
});

export async function createMcpServer(): Promise<McpServer> {
  const accepts = await getAccepts();

  const paid = createPaymentWrapper(resourceServer, {
    accepts,
    resource: {
      url: `mcp://tool/${TOOL_NAME}`,
      description: TOOL_DESCRIPTION,
      mimeType: 'application/json',
      serviceName: config.serviceName,
      tags: config.serviceTags
    },
    extensions: bazaarExtensions
  });

  const server = new McpServer(
    {
      name: config.serviceName,
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      },
      instructions:
        'Paid x402 web surface parser. Call surface_markdown_parser with a public URL to receive token-efficient Markdown. Payment is USDC via x402; the server auto-selects network (Base default, or pass paymentNetwork / payerAddress). Supported networks: ' +
        config.networks.join(', ') +
        '.'
    }
  );

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Web Surface Markdown Parser',
      description: `${TOOL_DESCRIPTION} Price: ${priceLabel()} USDC per call.`,
      inputSchema: {
        url: z.string().url().describe('Public http(s) URL to fetch and convert')
      }
    },
    paid(async ({ url }) => {
      try {
        const { markdown, bytes, cache, render } = await resolveSurfaceMarkdown(url);
        return {
          content: [
            {
              type: 'text',
              text: markdown
            }
          ],
          structuredContent: { source: url, bytes, cache, render }
        };
      } catch (err) {
        const message = err instanceof UrlSafetyError ? err.message : err instanceof Error ? err.message : 'Parse failed';
        return {
          isError: true,
          content: [{ type: 'text', text: message }]
        };
      }
    })
  );

  return server;
}
