import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'melon_datakit — Mock 数据平台',
  description:
    'OpenAPI 驱动的 mock 数据服务平台：自动生成、状态化 CRUD、流式处理、完整控制台',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-rule-strong)] bg-[var(--color-surface)]">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
            <Link href="/" className="flex items-center gap-2.5">
              {/* 签名元素：朱印 —— 品牌印 */}
              <span className="seal-mark h-7 w-7 text-[13px]">DK</span>
              <span className="h-display text-[15px]">melon_datakit</span>
            </Link>
            <span className="mono text-[11px] tracking-[0.12em] text-[var(--color-ink-3)]">
              契约即数据
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
