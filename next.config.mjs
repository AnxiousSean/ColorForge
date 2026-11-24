/**
 * Static export: the whole app is client-side (IndexedDB + in-browser PDF),
 * so it deploys to any static host with no server.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
};

export default nextConfig;
