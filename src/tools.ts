import { config } from './config.js';

export const TOOL_NAME = 'surface_markdown_parser' as const;
export const STEALTH_TOOL_NAME = 'stealth_markdown_parser' as const;
export const TIMER_TOOL_NAME = 'agent_timer' as const;

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion.';

export const TIMER_TOOL_DESCRIPTION =
  'Schedule a future callback for autonomous agents. Register a JSON payload to be delivered to your HTTPS callback URL (push) or held for retrieval (poll) after a delay or at a set time. Lets agent loops wait on external events without holding compute open or burning tokens on busy-polling.';

/** What the stealth tier can actually do right now, based on what is provisioned. */
export function stealthCapabilities(): { proxy: boolean; captcha: boolean } {
  return {
    proxy: config.stealth.proxyUrls.length > 0,
    captcha: config.stealth.captchaSolverProvider !== 'none'
  };
}

/**
 * Honest, capability-gated description for the stealth tier. We only advertise
 * residential proxies / CAPTCHA solving when they are actually configured, so the
 * listing never over-promises. Auto-upgrades once the env vars are set.
 */
export function stealthToolDescription(): string {
  const { proxy, captcha } = stealthCapabilities();
  const extras: string[] = [];
  if (proxy) extras.push('residential proxy rotation');
  if (captcha) extras.push('automated CAPTCHA solving (Turnstile/reCAPTCHA/hCaptcha)');
  const extraText = extras.length ? ` Adds ${extras.join(' and ')}.` : '';
  const reach =
    proxy && captcha
      ? ' Handles bot-protected pages (e.g. Cloudflare/Akamai).'
      : ' Best for JavaScript-heavy/SPA pages and light bot checks; not guaranteed against advanced anti-bot walls (e.g. Cloudflare/Akamai).';
  return `Hardened headless-browser fetch with full JavaScript/SPA rendering and a realistic browser profile, returning fully rendered Markdown.${extraText}${reach}`;
}

export function stealthFeatures(): string[] {
  const { proxy, captcha } = stealthCapabilities();
  const features = ['headless-browser-render', 'spa-rendering'];
  if (proxy) features.push('proxy-rotation');
  if (captcha) features.push('captcha-solving');
  return features;
}

export type ToolName = typeof TOOL_NAME | typeof STEALTH_TOOL_NAME | typeof TIMER_TOOL_NAME;

export function isStealthTool(tool: string | undefined): tool is typeof STEALTH_TOOL_NAME {
  return tool === STEALTH_TOOL_NAME;
}

export function priceForTool(tool: ToolName): number {
  if (tool === STEALTH_TOOL_NAME) return config.stealth.priceUsdc;
  if (tool === TIMER_TOOL_NAME) return config.timer.priceUsdc;
  return config.priceUsdc;
}

export function descriptionForTool(tool: ToolName): string {
  if (tool === STEALTH_TOOL_NAME) return stealthToolDescription();
  if (tool === TIMER_TOOL_NAME) return TIMER_TOOL_DESCRIPTION;
  return TOOL_DESCRIPTION;
}

export function executePathForTool(tool: ToolName): string {
  if (tool === STEALTH_TOOL_NAME) return '/stealth-scrape';
  if (tool === TIMER_TOOL_NAME) return '/agent-timer';
  return '/mcp/execute';
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

export function timerPriceLabel(): string {
  return priceLabelFor(config.timer.priceUsdc);
}
