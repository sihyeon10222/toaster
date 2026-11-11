import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 배포용: .next/standalone 에 실행에 필요한 파일만 모은다 (toaster-client/deploy/Dockerfile)
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
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
