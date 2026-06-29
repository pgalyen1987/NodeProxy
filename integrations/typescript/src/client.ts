export const DEFAULT_API_URL = 'https://nodeproxy-production.up.railway.app/mcp/execute';

export const TOOL_NAME = 'surface_markdown_parser';

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion. Paid per request via x402 USDC micropayment.';

export interface ParseResult {
  markdown: string;
  transaction?: string;
  network?: string;
}

import { createPaidFetch } from './x402-fetch.js';

export interface NodeProxyClientOptions {
  apiUrl?: string;
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
}

export class NodeProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeProxyError';
  }
}

export class NodeProxyClient {
  private readonly apiUrl: string;
  private readonly evmPrivateKey?: string;
  private readonly solanaPrivateKey?: string;
  private fetchFn: typeof fetch | null = null;

  constructor(options: NodeProxyClientOptions = {}) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.evmPrivateKey = options.evmPrivateKey ?? process.env.EVM_PRIVATE_KEY;
    this.solanaPrivateKey = options.solanaPrivateKey ?? process.env.SOLANA_PRIVATE_KEY;
  }

  private async getFetch(): Promise<typeof fetch> {
    if (this.fetchFn) return this.fetchFn;
    try {
      this.fetchFn = await createPaidFetch({
        evmPrivateKey: this.evmPrivateKey,
        solanaPrivateKey: this.solanaPrivateKey
      });
    } catch (err) {
      throw new NodeProxyError(err instanceof Error ? err.message : String(err));
    }
    return this.fetchFn;
  }

  async parseUrl(url: string): Promise<ParseResult> {
    const paidFetch = await this.getFetch();
    const response = await paidFetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: TOOL_NAME, arguments: { url } })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new NodeProxyError(`NodeProxy HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      settlement?: { transaction?: string; network?: string };
    };

    const text = data.content?.[0]?.text;
    if (!text) {
      throw new NodeProxyError(`Unexpected NodeProxy response: ${JSON.stringify(data)}`);
    }

    return {
      markdown: text,
      transaction: data.settlement?.transaction,
      network: data.settlement?.network
    };
  }
}
