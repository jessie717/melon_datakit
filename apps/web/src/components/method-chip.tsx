import type { HttpMethod } from '@/lib/api';

const STYLES: Record<string, { bg: string; color: string; label: string }> = {
  GET: { bg: 'var(--color-get-soft)', color: 'var(--color-get)', label: 'GET' },
  POST: { bg: 'var(--color-post-soft)', color: 'var(--color-post)', label: 'POST' },
  PUT: { bg: 'var(--color-put-soft)', color: 'var(--color-put)', label: 'PUT' },
  PATCH: { bg: 'var(--color-put-soft)', color: 'var(--color-put)', label: 'PATCH' },
  DELETE: { bg: 'var(--color-delete-soft)', color: 'var(--color-delete)', label: 'DELETE' },
  HEAD: { bg: 'var(--color-code-bg)', color: 'var(--color-ink-2)', label: 'HEAD' },
  OPTIONS: { bg: 'var(--color-code-bg)', color: 'var(--color-ink-2)', label: 'OPTIONS' },
};

export function MethodChip({ method, size = 'md' }: { method: HttpMethod | string; size?: 'sm' | 'md' }) {
  const s = STYLES[method] ?? STYLES['OPTIONS']!;
  return (
    <span
      className="mono inline-flex items-center justify-center rounded-[2px] font-semibold"
      style={{
        background: s.bg,
        color: s.color,
        fontSize: size === 'sm' ? 10 : 11,
        letterSpacing: '0.06em',
        padding: size === 'sm' ? '2px 6px' : '3px 8px',
        minWidth: size === 'sm' ? 46 : 56,
      }}
    >
      {s.label}
    </span>
  );
}
