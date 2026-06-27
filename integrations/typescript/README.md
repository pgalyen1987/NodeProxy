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
npm run build
npm publish --access public
```

Then open a PR to `@langchain/community` mirroring the Python `langchain-community-pr/` folder.
