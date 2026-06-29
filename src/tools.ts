import { config } from './config.js';

export const TOOL_NAME = 'surface_markdown_parser' as const;
export const STEALTH_TOOL_NAME = 'stealth_markdown_parser' as const;

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion.';

export const STEALTH_TOOL_DESCRIPTION =
  'Anti-bot stealth fetch: residential proxy rotation, hardened Playwright, optional CAPTCHA solving. Returns fully rendered Markdown from Cloudflare/Akamai-protected pages.';

export type ToolName = typeof TOOL_NAME | typeof STEALTH_TOOL_NAME;

export function isStealthTool(tool: string | undefined): tool is typeof STEALTH_TOOL_NAME {
  return tool === STEALTH_TOOL_NAME;
}

export function priceForTool(tool: ToolName): number {
  return tool === STEALTH_TOOL_NAME ? config.stealth.priceUsdc : config.priceUsdc;
}

export function descriptionForTool(tool: ToolName): string {
  return tool === STEALTH_TOOL_NAME ? STEALTH_TOOL_DESCRIPTION : TOOL_DESCRIPTION;
}

export function executePathForTool(tool: ToolName): string {
  return tool === STEALTH_TOOL_NAME ? '/stealth-scrape' : '/mcp/execute';
}

export function priceLabelFor(usdc: number): string {
  return `$${usdc.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}

export function priceLabel(): string {
  return priceLabelFor(config.priceUsdc);
}

export function stealthPriceLabel(): string {
  return priceLabelFor(config.stealth.priceUsdc);
}
