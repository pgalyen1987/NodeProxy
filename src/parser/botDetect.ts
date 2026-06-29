export type BotBlockKind =
  | 'cloudflare'
  | 'akamai'
  | 'captcha'
  | 'access_denied'
  | 'rate_limit'
  | 'unknown';

export interface BotDetection {
  blocked: boolean;
  kind: BotBlockKind | null;
  signals: string[];
}

const SIGNAL_PATTERNS: Array<{ kind: BotBlockKind; patterns: RegExp[] }> = [
  {
    kind: 'cloudflare',
    patterns: [
      /cf-browser-verification/i,
      /challenge-platform/i,
      /cdn-cgi\/challenge-platform/i,
      /just a moment/i,
      /checking your browser/i,
      /cloudflare/i
    ]
  },
  {
    kind: 'akamai',
    patterns: [/akamai/i, /ak_bmsc/i, /bm_sz/i]
  },
  {
    kind: 'captcha',
    patterns: [
      /g-recaptcha/i,
      /hcaptcha/i,
      /cf-turnstile/i,
      /captcha/i,
      /recaptcha/i
    ]
  },
  {
    kind: 'access_denied',
    patterns: [/access denied/i, /403 forbidden/i, /blocked/i, /unusual traffic/i]
  },
  {
    kind: 'rate_limit',
    patterns: [/too many requests/i, /rate limit/i, /429/i]
  }
];

export function detectBotBlock(html: string, title?: string | null): BotDetection {
  const haystack = `${title || ''}\n${html}`.slice(0, 200_000);
  const signals: string[] = [];
  let kind: BotBlockKind | null = null;

  for (const group of SIGNAL_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(haystack)) {
        signals.push(group.kind);
        kind = kind ?? group.kind;
        break;
      }
    }
  }

  const blocked = signals.length > 0;
  return { blocked, kind, signals: [...new Set(signals)] };
}

export function stealthHintPayload(publicUrl: string, reason: string, priceUsdc: number) {
  return {
    tool: 'stealth_markdown_parser',
    endpoint: `${publicUrl}/stealth-scrape`,
    executeEndpoint: `${publicUrl}/mcp/execute`,
    priceUsdc,
    reason
  };
}
