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
      currency: 'USDC',
      autoNegotiation: {
        enabled: true,
        mode: 'auto',
        selectionOrder: ['explicit header/body', 'payer USDC balance', 'Base default'],
        payerHintFields: ['payerAddress', 'X-Payer-Address'],
        networkHintFields: ['paymentNetwork', 'X-Payment-Network'],
        allNetworksHeader: 'X-Payment-Options: all'
      },
      network: config.network,
      networks: config.networks,
      networkOptions: config.networkPayments.map((n) => ({
        network: n.network,
        label: n.label,
        asset: n.asset,
        priceUsdc: config.priceUsdc,
        payTo: config.walletAddress
      })),
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
          networks: config.networks,
          assets: config.networkPayments.map((n) => ({ network: n.network, asset: n.asset }))
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

/** x402 + OpenAPI-style discovery for Bazaar crawlers and agent routers. */
export function buildX402WellKnownManifest() {
  const manifest = buildToolsManifest();
  return {
    x402Version: 2,
    service: config.serviceName,
    description: manifest.description,
    websiteUrl: config.publicUrl,
    repository: 'https://github.com/pgalyen1987/NodeProxy',
    mcpRegistry: 'io.github.pgalyen1987/nodeproxy',
    packages: {
      pypi: { name: 'nodeproxy-tools', extras: ['x402', 'langchain'] },
      npm: { name: '@nodeproxy/langchain', peer: '@langchain/core' }
    },
    payments: manifest.payments,
    resources: [
      {
        type: 'mcp',
        url: `${config.publicUrl}/mcp/execute`,
        transport: `${config.publicUrl}/mcp`,
        toolName: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: toolInputSchema,
        pricing: {
          amountUsdc: config.priceUsdc,
          network: config.network,
          networks: config.networks
        }
      }
    ],
    discovery: manifest.discovery
  };
}

/** Compact agent routing card for LLM tool-matching and MCP clients. */
export function buildAgentDiscoveryCard() {
  return {
    name: config.serviceName,
    version: '1.0.0',
    description: TOOL_DESCRIPTION,
    capabilities: ['web-fetch', 'markdown-extraction', 'x402-micropayment'],
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        endpoint: `${config.publicUrl}/mcp/execute`,
        mcpTransport: `${config.publicUrl}/mcp`,
        inputSchema: toolInputSchema,
        payment: {
          protocol: 'x402',
          priceUsdc: config.priceUsdc,
          network: config.network,
          networks: config.networks,
          payTo: config.walletAddress
        }
      }
    ],
    install: {
      pip: 'pip install "nodeproxy-tools[x402,langchain]"',
      npm: 'npm install @nodeproxy/langchain @langchain/core',
      mcpRemote: `${config.publicUrl}/mcp`,
      env: ['EVM_PRIVATE_KEY']
    },
    links: {
      health: `${config.publicUrl}/health`,
      tools: `${config.publicUrl}/mcp/tools`,
      wellKnownMcp: `${config.publicUrl}/.well-known/mcp.json`,
      wellKnownX402: `${config.publicUrl}/.well-known/x402.json`,
      mcpRegistry: 'io.github.pgalyen1987/nodeproxy'
    }
  };
}

export function buildRobotsTxt(): string {
  return `# NodeProxy — machine discovery (autonomous agents / MCP crawlers)
User-agent: *
Allow: /.well-known/
Allow: /discovery/
Allow: /mcp/tools
Allow: /registry/
Allow: /health
Disallow: /mcp/execute

# Discovery endpoints
# MCP registry: io.github.pgalyen1987/nodeproxy
# Well-known MCP: ${config.publicUrl}/.well-known/mcp.json
# Well-known x402: ${config.publicUrl}/.well-known/x402.json
# Agent card: ${config.publicUrl}/discovery/agent.json
`;
}
