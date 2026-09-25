import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * Content-Security-Policy without nonces (Next.js CSP guide, "without nonces"):
 * the App Router's inline bootstrap scripts and the inline theme script need
 * 'unsafe-inline' for script-src while pages stay statically prerendered; a
 * nonce policy would force every page to render dynamically. Everything else
 * is locked to this origin. There are no workers, WebAssembly, web fonts or
 * third-party origins in the browser bundle; images are same-origin plus
 * blob:/data: (upload preview, report download). `upgrade-insecure-requests`
 * is omitted because loopback/LAN demo deployments are served over HTTP.
 */
function contentSecurityPolicy(isDev) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  // The local Windows build runs on a 16 GB machine. Next's documented
  // webpack memory optimization reduces peak compiler retention without
  // weakening type-checking or changing the application graph.
  experimental: {
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
  },
  // Keep all Next build/cache artifacts inside the project on D: (default behavior:
  // .next is created in the project root, which is D:\AI EYE ANALYSIS PLATFORM).
  // Next 15/16 uses the stable top-level option. Keeping these native/server
  // packages external avoids bundling their platform-specific binaries.
  serverExternalPackages: ["sharp", "pdfjs-dist", "pdf-lib", "tesseract.js", "@napi-rs/canvas", "better-sqlite3"],
  // Response hardening for every route. Route-specific headers (e.g.
  // `CSP: sandbox` on stored PDFs) still apply on top of these; browsers
  // enforce every CSP header they receive, so a route can only tighten it.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(phase === PHASE_DEVELOPMENT_SERVER) },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        // HSTS only when the request reached the app over HTTPS (TLS
        // terminated by the reverse proxy). Plain-HTTP loopback/LAN demo
        // deployments must never be pinned to HTTPS.
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }],
      },
    ];
  },
});

export default nextConfig;
