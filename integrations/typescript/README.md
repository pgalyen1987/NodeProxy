# @nodeproxy/langchain

LangChain.js tool for the [NodeProxy](https://github.com/pgalyen1987/NodeProxy) x402 web surface parser.

## Install

```bash
npm install @nodeproxy/langchain @langchain/core
export EVM_PRIVATE_KEY=0x...
```

## Usage

```typescript
import { NodeProxyMarkdownTool } from '@nodeproxy/langchain';

const tool = new NodeProxyMarkdownTool();
const markdown = await tool.invoke({ url: 'https://example.com' });
console.log(markdown);
```

## Publish

```bash
# One-time: create free org "nodeproxy" at https://www.npmjs.com/org/create
# Token: https://www.npmjs.com/settings/~/tokens (Automation, publish)
export NPM_TOKEN=npm_...
bash publish.sh
```

Verify: `npm view @nodeproxy/langchain`
