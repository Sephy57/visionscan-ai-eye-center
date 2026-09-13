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
};

export default nextConfig;
