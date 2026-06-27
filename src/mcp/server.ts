import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPaymentWrapper } from '@x402/mcp';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { z } from 'zod';
import { config, priceLabel, TOOL_DESCRIPTION, TOOL_NAME } from '../config.js';
import { parseSurface, UrlSafetyError } from '../parser/surface.js';
import { ensureX402Ready, resourceServer } from '../x402/payments.js';

let acceptsCache: Awaited<ReturnType<typeof resourceServer.buildPaymentRequirements>> | null = null;

async function getAccepts() {
  if (!acceptsCache) {
    await ensureX402Ready();
    acceptsCache = await resourceServer.buildPaymentRequirements({
      scheme: 'exact',
      network: config.network,
      payTo: config.walletAddress || '0x0000000000000000000000000000000000000000',
      price: priceLabel(),
      maxTimeoutSeconds: 300
    });
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
        'Paid x402 web surface parser. Call surface_markdown_parser with a public URL to receive token-efficient Markdown. Payment settles on ' +
        config.network +
        ' via x402.'
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
        const { markdown, bytes } = await parseSurface(url);
        return {
          content: [
            {
              type: 'text',
              text: markdown
            }
          ],
          structuredContent: { source: url, bytes }
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
