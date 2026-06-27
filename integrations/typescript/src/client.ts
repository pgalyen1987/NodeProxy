export const DEFAULT_API_URL = 'https://nodeproxy-production.up.railway.app/mcp/execute';

export const TOOL_NAME = 'surface_markdown_parser';

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion. Paid per request via x402 USDC micropayment.';

export interface ParseResult {
  markdown: string;
  transaction?: string;
  network?: string;
}

export interface NodeProxyClientOptions {
  apiUrl?: string;
  evmPrivateKey?: string;
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
  private fetchFn: typeof fetch | null = null;

  constructor(options: NodeProxyClientOptions = {}) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.evmPrivateKey = options.evmPrivateKey ?? process.env.EVM_PRIVATE_KEY;
  }

  private async getFetch(): Promise<typeof fetch> {
    if (this.fetchFn) return this.fetchFn;

    if (!this.evmPrivateKey) {
      throw new NodeProxyError(
        'EVM_PRIVATE_KEY is required. Set the env var or pass evmPrivateKey to NodeProxyClient.'
      );
    }

    const { wrapFetchWithPayment } = await import('@x402/fetch');
    const { x402Client } = await import('@x402/core/client');
    const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
    const { privateKeyToAccount } = await import('viem/accounts');

    const client = new x402Client();
    const account = privateKeyToAccount(this.evmPrivateKey as `0x${string}`);
    registerExactEvmScheme(client, { signer: account });

    this.fetchFn = wrapFetchWithPayment(fetch, client);
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
