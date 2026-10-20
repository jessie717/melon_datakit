import type { NextConfig } from 'next';

const SERVER_ORIGIN = `http://localhost:${process.env.SERVER_PORT ?? 4000}`;

const nextConfig: NextConfig = {
  // 管理 API 代理到 Elysia —— 浏览器只连 Next.js，免 CORS
  async rewrites() {
    return [
      {
        source: '/_datakit/:path*',
        destination: `${SERVER_ORIGIN}/_datakit/:path*`,
      },
    ];
  },
  // monorepo：让 Next 能解析 workspace 包的 TS 源码
  transpilePackages: ['@datakit/shared', '@datakit/core'],
};

export default nextConfig;
