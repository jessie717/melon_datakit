'use client';

import { useState } from 'react';

export function CopyButton({
  text,
  label = '复制',
  copiedLabel = '已复制',
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className ?? 'btn btn-ghost'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // clipboard 不可用时降级：选中文本由用户手动复制
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
