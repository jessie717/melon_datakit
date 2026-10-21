'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: '', label: '路由表' },
  { key: 'data', label: '数据' },
  { key: 'logs', label: '日志' },
  { key: 'settings', label: '设置' },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="mb-6 flex gap-1 border-b border-rule-strong">
      {TABS.map((tab) => {
        const href = tab.key ? `${base}/${tab.key}` : base;
        const active = tab.key
          ? pathname.startsWith(href)
          : pathname === base;
        return (
          <Link
            key={tab.key}
            href={href}
            className="mono relative px-4 py-2.5 text-[12px] tracking-[0.06em]"
            style={{
              color: active ? 'var(--color-ink)' : 'var(--color-ink-3)',
              fontWeight: active ? 600 : 400,
              borderBottom: active ? '2px solid var(--color-seal)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
