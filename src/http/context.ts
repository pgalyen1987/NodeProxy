import type { Context } from 'hono';
import { HonoHttpAdapter } from './adapter.js';
import type { HTTPRequestContext } from '@x402/core/server';

export function buildRequestContext(c: Context): HTTPRequestContext {
  return {
    adapter: new HonoHttpAdapter(c),
    path: c.req.path,
    method: c.req.method,
    paymentHeader: c.req.header('payment-signature') || c.req.header('PAYMENT-SIGNATURE'),
    routePattern: c.req.routePath
  };
}
