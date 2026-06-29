import type { Context } from 'hono';
import { resolveSurfaceMarkdown } from '../parser/resolve.js';
import { resolveStealthMarkdown } from '../parser/stealthResolve.js';
import { UrlSafetyError } from '../parser/surface.js';
import { StealthBlockedError } from '../parser/stealthSurface.js';
import { ConcurrencyError } from '../lib/guards.js';
import { releaseProof } from '../x402/payments.js';
import { isStealthTool, type ToolName } from '../tools.js';

export type ParseSettlement =
  | { protocol: 'x402'; transaction?: string; network?: string; tool: ToolName }
  | { protocol: 'mpp'; method: 'stripe/charge'; reference?: string; tool: ToolName };

export async function runParse(url: string, tool: ToolName) {
  if (isStealthTool(tool)) {
    const result = await resolveStealthMarkdown(url);
    return {
      body: {
        content: [{ type: 'text' as const, text: result.markdown }],
        cache: { status: result.cache, cachedAt: result.cachedAt },
        render: result.render,
        stealth: {
          proxyUsed: result.proxyUsed,
          captchaSolved: result.captchaSolved,
          attempts: result.attempts
        }
      },
      headers: {
        'X-Cache': result.cache,
        'X-Render': result.render,
        'X-Stealth-Proxy': result.proxyUsed ? 'yes' : 'no',
        ...(result.cachedAt ? { 'X-Cache-At': result.cachedAt } : {})
      }
    };
  }

  const { markdown, cache, cachedAt, render, stealthHint } = await resolveSurfaceMarkdown(url);
  return {
    body: {
      content: [{ type: 'text' as const, text: markdown }],
      cache: { status: cache, cachedAt },
      render,
      ...(stealthHint ? { stealthHint } : {})
    },
    headers: {
      'X-Cache': cache,
      'X-Render': render,
      ...(stealthHint ? { 'X-Stealth-Hint': 'upgrade-available' } : {}),
      ...(cachedAt ? { 'X-Cache-At': cachedAt } : {})
    }
  };
}

export async function respondWithParseResult(
  c: Context,
  url: string,
  tool: ToolName,
  settlement: ParseSettlement,
  paymentHeaders: Record<string, string>,
  proofKey?: string
) {
  try {
    const parsed = await runParse(url, tool);
    return c.json(
      { ...parsed.body, settlement },
      200,
      { ...paymentHeaders, ...parsed.headers }
    );
  } catch (err) {
    if (proofKey) releaseProof(proofKey);
    if (err instanceof UrlSafetyError) return c.json({ error: err.message }, 400);
    if (err instanceof StealthBlockedError) {
      return c.json({ error: err.message, kind: err.kind, retry: false }, 502);
    }
    if (err instanceof ConcurrencyError) return c.json({ error: err.message }, 503);
    return c.json({ error: err instanceof Error ? err.message : 'Parse failed' }, 502);
  }
}

export async function buildParseWebResponse(
  url: string,
  tool: ToolName,
  settlement: ParseSettlement,
  proofKey?: string
): Promise<Response> {
  try {
    const parsed = await runParse(url, tool);
    return new Response(JSON.stringify({ ...parsed.body, settlement }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...parsed.headers }
    });
  } catch (err) {
    if (proofKey) releaseProof(proofKey);
    const status =
      err instanceof UrlSafetyError ? 400 : err instanceof ConcurrencyError ? 503 : 502;
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Parse failed',
        ...(err instanceof StealthBlockedError ? { kind: err.kind } : {})
      }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
