import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

async function main() {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NodeProxy MCP stdio transport ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
