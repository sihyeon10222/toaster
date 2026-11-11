import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 배포용: .next/standalone 에 실행에 필요한 파일만 모은다 (toaster-client/deploy/Dockerfile)
  output: "standalone",
  // 텔레그램 스티커 변환(/api/telegram)이 쓰는 ffmpeg 실행 파일. 묶지 않고 node_modules 에서 그대로 쓴다.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/telegram": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
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
