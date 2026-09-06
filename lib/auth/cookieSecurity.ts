/**
 * Cookie transport policy.
 *
 * Production sessions must use Secure cookies. An HTTP private-LAN address is
 * not a secure transport: a browser silently drops a Secure cookie there,
 * which otherwise looks like a successful login followed by a redirect loop.
 * A developer may make an explicit, narrowly scoped local-testing exception;
 * it can never apply to public hosts and must not be used for deployment.
 */

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export interface CookieTransportRequest {
  protocol: string;
  hostname: string;
  forwardedProto?: string | null;
}

export interface CookieTransportPolicy {
  secure: boolean;
  allowed: boolean;
  reason?: "https_required";
}

export function cookieTransportPolicy(request: CookieTransportRequest): CookieTransportPolicy {
  const production = process.env.NODE_ENV === "production";
  if (!production) return { secure: false, allowed: true };

  // Proxy headers are honored only after an operator has explicitly opted in.
  // This prevents a direct client from spoofing HTTPS to obtain an insecure
  // transport policy.
  const forwardedHttps = process.env.TRUST_PROXY === "true"
    && request.forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
  const directHttps = request.protocol.toLowerCase() === "https:";
  if (directHttps || forwardedHttps) return { secure: true, allowed: true };

  // This is intentionally opt-in and limited to private/loopback hosts for
  // an isolated local demo. It never changes the default production policy.
  if (process.env.ALLOW_INSECURE_LOCAL_AUTH === "true" && isPrivateOrLoopbackHost(request.hostname)) {
    return { secure: false, allowed: true };
  }
  return { secure: true, allowed: false, reason: "https_required" };
}

