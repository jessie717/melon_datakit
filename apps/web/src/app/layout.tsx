import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'melon_datakit — Mock 数据平台',
  description:
    'OpenAPI 驱动的 mock 数据服务平台：自动生成、状态化 CRUD、流式处理、完整控制台',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
