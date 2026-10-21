'use client';

import { useRef, useState } from 'react';
import { CopyButton } from './copy-button';

/**
 * 流式路由的操作面板：下载直链 / 上传试传 / SSE 预览。
 */
export function StreamPanel({
  kind,
  mockUrl,
}: {
  kind: 'upload' | 'download' | 'sse';
  mockUrl: string;
}) {
  if (kind === 'download') return <DownloadPanel mockUrl={mockUrl} />;
  if (kind === 'upload') return <UploadPanel mockUrl={mockUrl} />;
  return <SsePanel mockUrl={mockUrl} />;
}

function DownloadPanel({ mockUrl }: { mockUrl: string }) {
  const [size, setSize] = useState('1048576');
  const url = `${mockUrl}?size=${size}`;
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-[13px] font-semibold">下载</h3>
      <p className="mb-3 text-[12px] text-ink-2">
        内容由 mock 引擎确定性生成（同地址字节级一致），支持 Range 断点续传。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-ink-2">大小（字节）</label>
        <input
          className="field max-w-[140px]"
          value={size}
          onChange={(e) => setSize(e.target.value.replace(/\D/g, ''))}
        />
        <a className="btn" href={url} download>
          下载文件
        </a>
        <CopyButton text={url} label="复制链接" className="btn btn-ghost" />
      </div>
    </div>
  );
}

function UploadPanel({ mockUrl }: { mockUrl: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(mockUrl, { method: 'POST', body: form });
      const text = await res.text();
      setResult(`HTTP ${res.status}\n${text}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-[13px] font-semibold">上传</h3>
      <p className="mb-3 text-[12px] text-ink-2">
        流式接收（大文件不占内存），响应含文件名、大小与 sha256。
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
          选择文件
        </button>
        <span className="mono max-w-[220px] truncate text-[12px] text-ink-3">
          {file ? `${file.name}（${formatBytes(file.size)}）` : '未选择文件'}
        </span>
        <button className="btn" disabled={!file || busy} onClick={upload}>
          {busy ? '上传中…' : '上传'}
        </button>
      </div>
      {error && <p className="mono mt-3 text-[12px] text-seal">{error}</p>}
      {result && (
        <pre className="mono mt-3 max-h-48 overflow-auto rounded-xs bg-code-bg p-3 text-[11px] text-ink">
          {result}
        </pre>
      )}
    </div>
  );
}

function SsePanel({ mockUrl }: { mockUrl: string }) {
  const [events, setEvents] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  async function toggle() {
    if (running) {
      ctrlRef.current?.abort();
      setRunning(false);
      return;
    }
    setRunning(true);
    setEvents([]);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const res = await fetch(`${mockUrl}?interval=500`, { signal: ctrl.signal });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const frame of parts) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) {
            setEvents((prev) => [...prev.slice(-19), dataLine.slice(6)]);
          }
        }
      }
    } catch {
      // abort 或断开 —— 正常收尾
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-[13px] font-semibold">事件流（SSE）</h3>
      <div className="mb-3 flex items-center gap-2">
        <button className={running ? 'btn btn-ghost' : 'btn'} onClick={toggle}>
          {running ? '停止' : '开始监听'}
        </button>
        <span className="mono text-[11px] text-ink-3">已收 {events.length} 条</span>
      </div>
      {events.length > 0 && (
        <pre className="mono max-h-64 overflow-auto rounded-xs bg-code-bg p-3 text-[11px] text-ink">
          {events.join('\n')}
        </pre>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
