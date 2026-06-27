import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { NodeProxyClient, TOOL_DESCRIPTION, TOOL_NAME } from './client.js';

const schema = z.object({
  url: z.string().describe('Public website URL to parse into LLM-ready Markdown.')
});

export type NodeProxyMarkdownToolFields = {
  client?: NodeProxyClient;
  apiUrl?: string;
  evmPrivateKey?: string;
};

export class NodeProxyMarkdownTool extends StructuredTool {
  name = TOOL_NAME;
  description = TOOL_DESCRIPTION;
  schema = schema;

  private readonly client: NodeProxyClient;

  constructor(fields: NodeProxyMarkdownToolFields = {}) {
    super();
    this.client =
      fields.client ??
      new NodeProxyClient({ apiUrl: fields.apiUrl, evmPrivateKey: fields.evmPrivateKey });
  }

  protected async _call(input: z.infer<typeof schema>): Promise<string> {
    const result = await this.client.parseUrl(input.url);
    return result.markdown;
  }
}
