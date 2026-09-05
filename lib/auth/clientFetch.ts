"use client";

/**
 * Client-side fetch wrapper that attaches the CSRF header (double-submit
 * cookie pattern) for state-changing requests. The session cookie itself is
 * httpOnly and sent automatically by the browser; only the CSRF token needs
 * to be read from JS and echoed back as a header.
 */

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function csrfHeader(): Record<string, string> {
  const token = readCookie("vsa_csrf");
  return token ? { "x-csrf-token": token } : {};
}

/** Drop-in fetch replacement: same signature, adds the CSRF header automatically for mutating methods. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  const headers = mutating ? { ...(init.headers as Record<string, string> | undefined), ...csrfHeader() } : init.headers;
  return fetch(input, { ...init, headers });
}
