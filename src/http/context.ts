import type { Context } from 'hono';
import { HonoHttpAdapter } from './adapter.js';
import type { HTTPRequestContext } from '@x402/core/server';
import { extractPaymentHeader } from '../x402/v1.js';

export function buildRequestContext(c: Context): HTTPRequestContext {
  return {
    adapter: new HonoHttpAdapter(c),
    path: c.req.path,
    method: c.req.method,
    paymentHeader: extractPaymentHeader((n) => c.req.header(n)),
    routePattern: c.req.routePath
  };
}
