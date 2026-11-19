/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a fully static export (web/out) that the Go binary embeds.
  output: "export",
  // Served from the Go binary at the domain root; relative asset paths.
  images: { unoptimized: true },
  trailingSlash: false,
  reactStrictMode: true,
};

module.exports = nextConfig;
