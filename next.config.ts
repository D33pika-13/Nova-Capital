import type { NextConfig } from "next";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft") as {
  nodeFileTrace(
    files: string[],
    options: { base: string; processCwd: string },
  ): Promise<{ fileList: Set<string> }>;
};
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Offer image access is rechecked on every request; no optimizer cache may retain it.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.APP_ENV === "production" ||
          process.env.APP_ENV === "staging"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          },
        ],
      },
    ];
  },
};
export default async function nextConfig(): Promise<NextConfig> {
  const root = process.cwd();
  const { fileList } = await nodeFileTrace(
    [
      "scripts/pdf-validation-worker.mjs",
      "scripts/run-maintenance.mjs",
      "scripts/image-validation-worker.mjs",
    ],
    { base: root, processCwd: root },
  );
  return {
    ...config,
    outputFileTracingIncludes: {
      "/*": [...fileList].map((file) => `./${file}`),
    },
  };
}
