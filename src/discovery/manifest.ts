import { config } from '../config.js';
import { mppSnapshot } from '../mpp/config.js';
import {
  TOOL_NAME,
  STEALTH_TOOL_NAME,
  TIMER_TOOL_NAME,
  TOOL_DESCRIPTION,
  TIMER_TOOL_DESCRIPTION,
  stealthToolDescription,
  stealthFeatures,
  priceLabel,
  stealthPriceLabel,
  timerPriceLabel
} from '../tools.js';

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

function buildStandardPricing() {
  return {
    x402: {
      amount: priceLabel(),
      priceUsdc: config.priceUsdc,
      network: config.network,
      networks: config.networks,
      assets: config.networkPayments.map((n) => ({ network: n.network, asset: n.asset }))
    },
    ...(config.mpp.enabled
      ? {
          mpp: {
            method: 'stripe/charge',
            amountUsd: config.mpp.stripeAmountUsd,
            currency: config.mpp.stripeCurrency
          }
        }
      : {})
  };
}

function buildStealthPricing() {
  return {
    x402: {
      amount: stealthPriceLabel(),
      priceUsdc: config.stealth.priceUsdc,
      network: config.network,
      networks: config.networks,
      assets: config.networkPayments.map((n) => ({ network: n.network, asset: n.asset }))
    }
  };
}

export const timerInputSchema = {
  type: 'object',
  properties: {
    delay_seconds: { type: 'number', description: 'Seconds from now to fire (preferred).' },
    fire_at: { type: 'number', description: 'Absolute fire time as epoch seconds (alternative to delay_seconds).' },
    callback_url: { type: 'string', description: 'HTTPS URL to POST the payload to at fire time (push mode). Omit for poll mode.' },
    payload: { description: 'Arbitrary JSON delivered/held verbatim at fire time.' },
    mode: { type: 'string', enum: ['push', 'poll'], description: 'push = POST to callback_url; poll = retrieve via GET /agent-timer/{id}.' }
  },
  required: []
} as const;

function buildTimerPricing() {
  return {
    x402: {
      amount: timerPriceLabel(),
      priceUsdc: config.timer.priceUsdc,
      network: config.network,
      networks: config.networks,
      assets: config.networkPayments.map((n) => ({ network: n.network, asset: n.asset }))
    }
  };
}

export function buildToolsManifest() {
  return {
    schema_version: '2024-11-05',
    name: config.serviceName,
    description:
      'x402-gated MCP server. Parses bloated JS-heavy websites into token-efficient Markdown for autonomous agents. Includes stealth anti-bot tier.',
    version: '1.1.0',
    transport: {
      type: 'streamable-http',
      url: `${config.publicUrl}/mcp`
    },
    payments: {
      protocols: ['x402', ...(config.mpp.enabled ? ['mpp'] : [])],
      x402: {
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
          payTo: n.payTo
        })),
        asset: config.usdcBase,
        payTo: config.networkPayments[0]?.payTo || config.walletAddress,
        facilitator: config.facilitatorUrl,
        authHeader: 'PAYMENT-SIGNATURE'
      },
      ...(config.mpp.enabled
        ? {
            mpp: {
              ...mppSnapshot(config.mpp),
              executeScope: 'POST /mcp/execute',
              authHeader: 'Authorization: Payment …',
              createTokenUrl: `${config.publicUrl}/mpp/stripe/create-token`,
              wellKnown: `${config.publicUrl}/.well-known/mpp.json`
            }
          }
        : {})
    },
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: toolInputSchema,
        endpoint: `${config.publicUrl}/mcp/execute`,
        pricing: buildStandardPricing()
      },
      {
        name: STEALTH_TOOL_NAME,
        description: stealthToolDescription(),
        inputSchema: toolInputSchema,
        endpoint: `${config.publicUrl}/stealth-scrape`,
        pricing: buildStealthPricing(),
        features: stealthFeatures()
      },
      {
        name: TIMER_TOOL_NAME,
        description: TIMER_TOOL_DESCRIPTION,
        inputSchema: timerInputSchema,
        endpoint: `${config.publicUrl}/agent-timer`,
        pricing: buildTimerPricing()
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
      stealthScrape: `${config.publicUrl}/stealth-scrape`,
      mcp: `${config.publicUrl}/mcp`
    },
    tools: buildToolsManifest().tools
  };
}

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
        pricing: { amountUsdc: config.priceUsdc, network: config.network, networks: config.networks }
      },
      {
        type: 'mcp',
        url: `${config.publicUrl}/stealth-scrape`,
        transport: `${config.publicUrl}/mcp`,
        toolName: STEALTH_TOOL_NAME,
        description: stealthToolDescription(),
        inputSchema: toolInputSchema,
        pricing: {
          amountUsdc: config.stealth.priceUsdc,
          network: config.network,
          networks: config.networks
        }
      }
    ],
    discovery: manifest.discovery
  };
}

export function buildMppWellKnownManifest() {
  const manifest = buildToolsManifest();
  return {
    mppVersion: 1,
    service: config.serviceName,
    description: manifest.description,
    websiteUrl: config.publicUrl,
    realm: new URL(config.publicUrl).host,
    execute: {
      url: `${config.publicUrl}/mcp/execute`,
      scope: 'POST /mcp/execute',
      tool: TOOL_NAME
    },
    methods: [
      {
        method: 'stripe/charge',
        intent: 'charge',
        currency: config.mpp.stripeCurrency,
        amountMinor: config.mpp.stripeAmountMinor,
        amountUsd: config.mpp.stripeAmountUsd,
        networkId: config.mpp.stripeNetworkId,
        paymentMethodTypes: config.mpp.stripePaymentMethodTypes,
        createTokenUrl: `${config.publicUrl}/mpp/stripe/create-token`
      }
    ],
    payments: manifest.payments
  };
}

export function buildAgentDiscoveryCard() {
  return {
    name: config.serviceName,
    version: '1.1.0',
    description: TOOL_DESCRIPTION,
    capabilities: [
      'web-fetch',
      'markdown-extraction',
      'x402-micropayment',
      'headless-browser-render',
      'scheduled-callback',
      ...(config.mpp.enabled ? ['mpp-stripe'] : [])
    ],
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        endpoint: `${config.publicUrl}/mcp/execute`,
        mcpTransport: `${config.publicUrl}/mcp`,
        inputSchema: toolInputSchema,
        payment: {
          x402: {
            protocol: 'x402',
            priceUsdc: config.priceUsdc,
            network: config.network,
            networks: config.networks,
            payTo: config.walletAddress,
            payToSolana: config.solanaWalletAddress || null
          },
          ...(config.mpp.enabled
            ? {
                mpp: {
                  protocol: 'mpp',
                  method: 'stripe/charge',
                  amountUsd: config.mpp.stripeAmountUsd,
                  currency: config.mpp.stripeCurrency
                }
              }
            : {})
        }
      },
      {
        name: STEALTH_TOOL_NAME,
        description: stealthToolDescription(),
        endpoint: `${config.publicUrl}/stealth-scrape`,
        mcpTransport: `${config.publicUrl}/mcp`,
        inputSchema: toolInputSchema,
        payment: {
          x402: {
            protocol: 'x402',
            priceUsdc: config.stealth.priceUsdc,
            network: config.network,
            networks: config.networks,
            payTo: config.walletAddress,
            payToSolana: config.solanaWalletAddress || null
          }
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
      stealthScrape: `${config.publicUrl}/stealth-scrape`,
      wellKnownMcp: `${config.publicUrl}/.well-known/mcp.json`,
      wellKnownX402: `${config.publicUrl}/.well-known/x402.json`,
      ...(config.mpp.enabled ? { wellKnownMpp: `${config.publicUrl}/.well-known/mpp.json` } : {}),
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
Disallow: /stealth-scrape

# Discovery endpoints
# MCP registry: io.github.pgalyen1987/nodeproxy
# Well-known MCP: ${config.publicUrl}/.well-known/mcp.json
# Well-known x402: ${config.publicUrl}/.well-known/x402.json
# Stealth scrape: ${config.publicUrl}/stealth-scrape
# Agent card: ${config.publicUrl}/discovery/agent.json
`;
}
