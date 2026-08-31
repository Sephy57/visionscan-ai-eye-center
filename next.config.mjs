/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep all Next build/cache artifacts inside the project on D: (default behavior:
  // .next is created in the project root, which is D:\AI EYE ANALYSIS PLATFORM).
  experimental: {
    serverComponentsExternalPackages: ["sharp"],
  },
};

export default nextConfig;
