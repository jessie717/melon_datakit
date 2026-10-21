'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, mockPath, type LogEntry, type Project } from '@/lib/api';
import { ProjectNav } from '@/components/project-nav';
import { MethodChip } from '@/components/method-chip';
import { JsonView } from '@/components/json-view';

interface LiveLog {
  id: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  seed?: number;
  error?: string;
  createdAt: string;
}

const STATUS_COLOR = (status: number) =>
  status < 300
    ? 'var(--color-get)'
    : status < 500
      ? 'var(--color-put)'
      : 'var(--color-seal)';

export default function LogsPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState<LiveLog[]>([]);
  const [connected, setConnected] = useState(false);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    const [p, res] = await Promise.all([
      api.getProject(params.id),
      api.listLogs(params.id, { pageSize: 50 }),
    ]);
    setProject(p);
    setLogs(res.items);
  }, [params.id]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  // 实时流：直连 Elysia SSE（跨域，服务端已开 CORS）
  useEffect(() => {
    const es = new EventSource(
      `http://localhost:4000/_datakit/admin/projects/${params.id}/stream`
    );
    esRef.current = es;
    es.addEventListener('hello', () => setConnected(true));
    es.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as LiveLog;
        setLive((prev) => [entry, ...prev].slice(0, 100));
      } catch {
        /* 忽略坏帧 */
      }
    });
    es.onerror = () => setConnected(false);
    return () => {
      es.close();
    };
  }, [params.id]);

  async function clear() {
    if (!confirm('确定清空全部请求日志？')) return;
    await api.clearLogs(params.id);
    setLogs([]);
    setLive([]);
  }

  // 合并展示：实时条目在上，历史条目在下（去重）
  const liveIds = new Set(live.map((l) => l.id));
  const merged: Array<LiveLog | LogEntry> = [
    ...live,
    ...logs.filter((l) => !liveIds.has(l.id)),
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">项目</Link>
        <span>/</span>
        <Link href={`/projects/${params.id}`} className="hover:text-ink hover:underline">
          {project?.name ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-ink">日志</span>
      </nav>

      <ProjectNav projectId={params.id} />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="eyebrow">请求日志</h2>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: connected ? 'var(--color-ok)' : 'var(--color-ink-3)' }}
            />
            <span className="mono text-ink-3">{connected ? '实时连接中' : '未连接'}</span>
          </span>
        </div>
        <button className="btn btn-ghost !py-1.5 text-[12px]" onClick={clear}>
          清空日志
        </button>
      </div>

      <div className="card overflow-x-auto">
        {merged.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] font-semibold">还没有请求记录</p>
            <p className="mt-1 text-[12px] text-ink-2">
              用 curl 或前端调一次 mock 接口，日志会实时出现在这里。
            </p>
            {project && (
              <p className="mono mt-2 text-[11px] text-ink-3">
                例如：GET http://localhost:4000{mockPath(project.slug)}/…
              </p>
            )}
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-[70px]">时间</th>
                <th className="w-[76px]">方法</th>
                <th>路径</th>
                <th className="w-[64px]">状态</th>
                <th className="w-[70px]">耗时</th>
                <th className="w-[110px]">seed</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer"
                  onClick={async () => {
                    // 只有历史条目有完整明细
                    if ('headers' in l) setDetail(l);
                    else {
                      const full = logs.find((x) => x.id === l.id);
                      if (full) setDetail(full);
                    }
                  }}
                >
                  <td className="mono text-[11px] text-ink-3">
                    {new Date(l.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </td>
                  <td><MethodChip method={l.method} size="sm" /></td>
                  <td className="mono text-[12px]">{l.path}</td>
                  <td>
                    <span className="mono text-[12px] font-semibold" style={{ color: STATUS_COLOR(l.status) }}>
                      {l.status}
                    </span>
                  </td>
                  <td className="mono text-[11px] text-ink-2">{l.latencyMs}ms</td>
                  <td className="mono text-[11px] text-ink-3">{l.seed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && <LogDetail log={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}

function LogDetail({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div className="card max-h-[85vh] w-full max-w-3xl overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <MethodChip method={log.method} />
          <span className="mono text-[14px]">{log.path}</span>
          <span className="mono text-[13px] font-semibold" style={{ color: STATUS_COLOR(log.status) }}>
            {log.status}
          </span>
          <span className="mono text-[11px] text-ink-3">{log.latencyMs}ms</span>
          {log.seed != null && <span className="mono text-[11px] text-ink-3">seed {log.seed}</span>}
        </div>

        {log.error && (
          <p className="mono mt-2 text-[12px] text-seal">错误：{log.error}</p>
        )}

        {Object.keys(log.query).length > 0 && (
          <Section title="查询参数">
            <JsonView value={log.query} maxHeight={120} />
          </Section>
        )}
        <Section title="请求头">
          <JsonView value={log.headers} maxHeight={140} />
        </Section>
        {log.requestBody !== undefined && (
          <Section title="请求体">
            <JsonView value={log.requestBody} maxHeight={180} />
          </Section>
        )}
        {log.responseBody !== undefined && (
          <Section title="响应体">
            <JsonView value={log.responseBody} maxHeight={220} />
          </Section>
        )}

        <div className="mt-5 flex gap-2">
          <button className="btn" onClick={() => void replay(log)}>
            重放请求
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

async function replay(log: LogEntry) {
  const qs = new URLSearchParams(log.query).toString();
  await fetch(`${log.path}${qs ? `?${qs}` : ''}`, {
    method: log.method,
    ...(log.requestBody !== undefined
      ? {
          body: JSON.stringify(log.requestBody),
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  }).catch(() => {});
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="eyebrow mb-2">{title}</h4>
      {children}
    </div>
  );
}
