// Guard for server-side requests to user-supplied URLs (webhooks, callbacks).
// Blocks requests to loopback, private, link-local and metadata addresses so the
// server can't be used to reach internal services (SSRF).
const dns = require('dns').promises;
const net = require('net');

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224                               // multicast / reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  return true;
};

/**
 * Returns null if the URL is safe to call, otherwise a reason string.
 * Set ALLOW_PRIVATE_WEBHOOKS=true to permit LAN targets (edge deployments).
 */
const checkOutboundUrl = async (rawUrl) => {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return 'invalid URL';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'only http(s) URLs are allowed';
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === 'true') return null;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'internal hostnames are not allowed';
  }
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return 'URL resolves to a private/internal address';
  } catch {
    return 'hostname could not be resolved';
  }
  return null;
};

/** POST JSON to a vetted URL with a timeout. Never throws. */
const postJson = async (rawUrl, body, { timeoutMs = 5000, userAgent = 'FlapMain-IoT-Engine/2.3' } = {}) => {
  const reason = await checkOutboundUrl(rawUrl);
  if (reason) return { ok: false, error: `blocked: ${reason}` };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'manual', // don't let a public URL redirect us to an internal one
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(t);
  }
};

module.exports = { checkOutboundUrl, postJson, isPrivateIp };
