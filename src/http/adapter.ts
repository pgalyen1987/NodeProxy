import type { Context } from 'hono';
import type { HTTPAdapter } from '@x402/core/server';

export class HonoHttpAdapter implements HTTPAdapter {
  constructor(private readonly c: Context) {}

  getHeader(name: string): string | undefined {
    return this.c.req.header(name);
  }

  getMethod(): string {
    return this.c.req.method;
  }

  getPath(): string {
    return this.c.req.path;
  }

  getUrl(): string {
    return this.c.req.url;
  }

  getAcceptHeader(): string {
    return this.c.req.header('accept') || '*/*';
  }

  getUserAgent(): string {
    return this.c.req.header('user-agent') || '';
  }
}
