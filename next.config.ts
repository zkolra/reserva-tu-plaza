import type { NextConfig } from "next";

// Cache Components queda desactivado: en Cloudflare Workers se cuelga
// (el runtime avisa de que su setTimeout no es compatible).
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
