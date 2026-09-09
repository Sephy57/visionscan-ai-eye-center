/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep all Next build/cache artifacts inside the project on D: (default behavior:
  // .next is created in the project root, which is D:\AI EYE ANALYSIS PLATFORM).
  // Next 15/16 uses the stable top-level option. Keeping these native/server
  // packages external avoids bundling their platform-specific binaries.
  serverExternalPackages: ["sharp", "pdfjs-dist", "tesseract.js", "@napi-rs/canvas", "better-sqlite3"],
};

export default nextConfig;
