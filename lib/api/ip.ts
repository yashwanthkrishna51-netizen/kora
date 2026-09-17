/**
 * The client's IP address, from headers the platform controls.
 *
 * THE OLD APP TRUSTED `X-Forwarded-For` VERBATIM (api/_audit.js:36-40). That
 * header is client-supplied: anyone could send a different value on every
 * request and thereby
 *
 *   - bypass the per-IP login throttle completely, since each attempt looked
 *     like it came from a new address, and
 *   - forge the `ip` column on any audit-log entry, which is the field you
 *     would rely on when investigating an incident.
 *
 * On Vercel, `x-real-ip` and `x-vercel-forwarded-for` are set by the proxy and
 * overwrite anything the client sent, so they cannot be spoofed from outside.
 * Raw `x-forwarded-for` is deliberately NOT consulted.
 */

const TRUSTED_HEADERS = ["x-real-ip", "x-vercel-forwarded-for"] as const;

export function clientIp(headers: Headers): string | null {
  for (const name of TRUSTED_HEADERS) {
    const value = headers.get(name);
    if (!value) continue;
    // x-vercel-forwarded-for can be a list; the first entry is the client.
    const first = value.split(",")[0]?.trim();
    if (first && isPlausibleIp(first)) return first;
  }

  // Local development has no proxy in front, so nothing sets these.
  if (process.env.NODE_ENV !== "production") return "127.0.0.1";

  return null;
}

/**
 * Shape check only. This value becomes a primary key in `login_ip_throttle`
 * and is written to the audit log, so an absurd value should not get that far
 * even though the headers above are already trusted.
 */
function isPlausibleIp(value: string): boolean {
  if (value.length > 45) return false; // longest possible IPv6 form
  return /^[0-9a-fA-F:.]+$/.test(value);
}

export function userAgent(headers: Headers): string | null {
  const ua = headers.get("user-agent");
  if (!ua) return null;
  return ua.slice(0, 500);
}
