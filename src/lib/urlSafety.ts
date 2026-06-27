const BLOCKED = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal', '169.254.169.254']);
const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

export class UrlSafetyError extends Error {
  status = 400;
}

export function assertPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UrlSafetyError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UrlSafetyError('Only http(s) URLs allowed');
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED.has(host) || host.endsWith('.local') || host.endsWith('.internal') || PRIVATE.test(host)) {
    throw new UrlSafetyError('Blocked or private URL');
  }
  return parsed;
}
