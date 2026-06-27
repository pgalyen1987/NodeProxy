import { config, priceLabel, TOOL_DESCRIPTION, TOOL_NAME } from '../config.js';

export const toolInputSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'Public http(s) URL to fetch, strip noise from, and return as Markdown.'
    }
  },
  required: ['url']
} as const;

export function buildToolsManifest() {
  return {
    schema_version: '2024-11-05',
    name: config.serviceName,
    description:
      'x402-gated MCP server. Parses bloated JS-heavy websites into token-efficient Markdown for autonomous agents.',
    version: '1.0.0',
    transport: {
      type: 'streamable-http',
      url: `${config.publicUrl}/mcp`
    },
    payments: {
      protocol: 'x402',
      network: config.network,
      asset: config.usdcBase,
      priceUsdc: config.priceUsdc,
      payTo: config.walletAddress,
      facilitator: config.facilitatorUrl
    },
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: toolInputSchema,
        pricing: {
          amount: priceLabel(),
          network: config.network,
          asset: config.usdcBase
        }
      }
    ],
    discovery: {
      bazaar: true,
      mcp_registry: `${config.publicUrl}/registry/server.json`,
      well_known: `${config.publicUrl}/.well-known/mcp.json`
    }
  };
}

export function buildWellKnownManifest() {
  return {
    mcpVersion: '2024-11-05',
    server: config.serviceName,
    endpoints: {
      tools: `${config.publicUrl}/mcp/tools`,
      execute: `${config.publicUrl}/mcp/execute`,
      mcp: `${config.publicUrl}/mcp`
    },
    tools: buildToolsManifest().tools
  };
}
