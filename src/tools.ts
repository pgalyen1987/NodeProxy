import { config } from './config.js';

export const TOOL_NAME = 'surface_markdown_parser' as const;
export const STEALTH_TOOL_NAME = 'stealth_markdown_parser' as const;
export const TIMER_TOOL_NAME = 'agent_timer' as const;
export const INBOX_TOOL_NAME = 'agent_inbox' as const;
export const LOCK_TOOL_NAME = 'agent_lock' as const;
export const SECRET_TOOL_NAME = 'agent_secret' as const;

export const TOOL_DESCRIPTION =
  'Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion.';

export const TIMER_TOOL_DESCRIPTION =
  'Schedule a future HTTP action or callback for autonomous agents. At a delay or a set time, either (a) execute an HTTP request you specify (method/url/headers/body) and capture the response for retrieval, or (b) deliver a JSON payload to your HTTPS callback URL (push) / hold it for polling. Lets agent loops defer and fire web actions without staying online or busy-polling.';

export const INBOX_TOOL_DESCRIPTION =
  'Ephemeral capture inbox for autonomous agents. Create a one-time ingest URL; anything POSTed to it (OAuth redirect, async job result, third-party webhook) is captured and held for you to poll. Bridges external pushes into pollable events for agents that have no public endpoint.';

export const LOCK_TOOL_DESCRIPTION =
  'Distributed lock / idempotency primitive for multi-agent swarms. claim(key) returns a token if free (with TTL); release(token) frees it; check(key) reports whether held. Stops multiple agents from double-processing the same work item.';

export const SECRET_TOOL_DESCRIPTION =
  'One-time secret relay for inter-agent handoff. store(secret) returns a token; redeem(token) returns the secret exactly once, then burns it. Pass credentials or short-lived values between agents without persisting them.';

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

export type ToolName =
  | typeof TOOL_NAME
  | typeof STEALTH_TOOL_NAME
  | typeof TIMER_TOOL_NAME
  | typeof INBOX_TOOL_NAME
  | typeof LOCK_TOOL_NAME
  | typeof SECRET_TOOL_NAME;

export function isStealthTool(tool: string | undefined): tool is typeof STEALTH_TOOL_NAME {
  return tool === STEALTH_TOOL_NAME;
}

export function priceForTool(tool: ToolName): number {
  switch (tool) {
    case STEALTH_TOOL_NAME:
      return config.stealth.priceUsdc;
    case TIMER_TOOL_NAME:
      return config.timer.priceUsdc;
    case INBOX_TOOL_NAME:
      return config.inbox.priceUsdc;
    case LOCK_TOOL_NAME:
      return config.lock.priceUsdc;
    case SECRET_TOOL_NAME:
      return config.secret.priceUsdc;
    default:
      return config.priceUsdc;
  }
}

export function descriptionForTool(tool: ToolName): string {
  switch (tool) {
    case STEALTH_TOOL_NAME:
      return stealthToolDescription();
    case TIMER_TOOL_NAME:
      return TIMER_TOOL_DESCRIPTION;
    case INBOX_TOOL_NAME:
      return INBOX_TOOL_DESCRIPTION;
    case LOCK_TOOL_NAME:
      return LOCK_TOOL_DESCRIPTION;
    case SECRET_TOOL_NAME:
      return SECRET_TOOL_DESCRIPTION;
    default:
      return TOOL_DESCRIPTION;
  }
}

export function executePathForTool(tool: ToolName): string {
  switch (tool) {
    case STEALTH_TOOL_NAME:
      return '/stealth-scrape';
    case TIMER_TOOL_NAME:
      return '/agent-timer';
    case INBOX_TOOL_NAME:
      return '/agent-inbox';
    case LOCK_TOOL_NAME:
      return '/agent-lock';
    case SECRET_TOOL_NAME:
      return '/agent-secret';
    default:
      return '/mcp/execute';
  }
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
