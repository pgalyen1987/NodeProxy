const BLOCKED = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1', 'metadata.google.internal', '169.254.169.254']);

export class UrlSafetyError extends Error {
  status = 400;
}

function parseRadixOctet(part: string): number | undefined {
  if (!part) return undefined;
  let value: number;
  if (/^0x[0-9a-f]+$/i.test(part)) value = parseInt(part, 16);
  else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
  else if (/^[0-9]+$/.test(part)) value = parseInt(part, 10);
  else return undefined;
  return Number.isFinite(value) ? value : undefined;
}

/** Decode an IPv4 host written in decimal, octal, or hex literal form to dotted-quad. */
function normalizeIpv4Literal(host: string): string | undefined {
  // Dotted form with non-decimal octets (e.g. 0x7f.0.0.1, 0177.0.0.1).
  const parts = host.split('.');
  if (parts.length === 4) {
    const octets = parts.map(parseRadixOctet);
    if (octets.every((o) => o !== undefined && o >= 0 && o <= 255)) {
      return octets.join('.');
    }
  }
  // Single integer form (e.g. http://2130706433 == 127.0.0.1).
  if (/^(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*|0)$/i.test(host)) {
    const asInt = parseRadixOctet(host);
    if (asInt !== undefined && asInt >= 0 && asInt <= 0xffffffff) {
      return [(asInt >>> 24) & 0xff, (asInt >>> 16) & 0xff, (asInt >>> 8) & 0xff, asInt & 0xff].join('.');
    }
  }
  return undefined;
}

function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true; // private, loopback, "this host"
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local fc00::/7
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // link-local fe80::/10
  // IPv4-mapped / -embedded (e.g. ::ffff:127.0.0.1).
  const v4 = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4 && isPrivateIpv4(v4[1])) return true;
  return false;
}

/**
 * Validate that a URL targets a public host, rejecting loopback/private/link-local
 * destinations and common SSRF obfuscations (octal/hex/integer IPv4, IPv6 literals,
 * embedded credentials). Note: this is a static check on the request URL only — it
 * does not resolve DNS, so callers that follow redirects must re-validate each hop.
 */
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
  if (parsed.username || parsed.password) {
    throw new UrlSafetyError('Credentials in URL are not allowed');
  }

  let host = parsed.hostname.toLowerCase();

  if (BLOCKED.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new UrlSafetyError('Blocked or private URL');
  }

  if (host.includes(':') || host.startsWith('[')) {
    if (isPrivateIpv6(host)) throw new UrlSafetyError('Blocked or private URL');
  }

  const normalizedV4 = normalizeIpv4Literal(host);
  if (normalizedV4) host = normalizedV4;
  if (isPrivateIpv4(host)) {
    throw new UrlSafetyError('Blocked or private URL');
  }

  return parsed;
}
