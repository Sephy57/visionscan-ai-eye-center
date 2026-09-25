/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // Baseline response hardening for every route. The CSP deliberately limits
  // itself to framing/base/object/form directives so it cannot break the
  // inline theme bootstrap or Next runtime scripts; route-specific headers
  // (e.g. `CSP: sandbox` on stored PDFs) still apply on top of these.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
