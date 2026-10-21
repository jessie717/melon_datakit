'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  api,
  mockPath,
  RequestError,
  type Project,
  type RouteSummary,
  type SpecRecord,
} from '@/lib/api';
import { MethodChip } from '@/components/method-chip';
import { CopyButton } from '@/components/copy-button';

const CRUD_LABEL: Record<string, string> = {
  list: '列表',
  create: '创建',
  get: '详情',
  update: '更新',
  delete: '删除',
  none: '—',
};

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [specs, setSpecs] = useState<SpecRecord[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([
        api.getProject(projectId),
        api.listSpecs(projectId),
        api.listRouteSummaries(projectId),
      ]);
      setProject(p);
      setSpecs(s);
      setRoutes(r);
      setError(null);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importFromUrl(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await api.importSpecUrl(projectId, importUrl);
      setImportMessage({
        kind: res.warnings.length > 0 ? 'warn' : 'ok',
        text:
          res.warnings.length > 0
            ? `已导入 ${res.routeCount} 条路由，${res.warnings.length} 条提示：${res.warnings[0]}`
            : `已导入 ${res.routeCount} 条路由（OpenAPI ${res.openapiVersion}）`,
      });
      setImportUrl('');
      await refresh();
    } catch (err) {
      setImportMessage({ kind: 'error', text: err instanceof RequestError ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  }

  async function importFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await api.importSpecFile(projectId, file);
      setImportMessage({
        kind: res.warnings.length > 0 ? 'warn' : 'ok',
        text:
          res.warnings.length > 0
            ? `已导入 ${res.routeCount} 条路由，${res.warnings.length} 条提示：${res.warnings[0]}`
            : `已导入 ${res.routeCount} 条路由（OpenAPI ${res.openapiVersion}）`,
      });
      await refresh();
    } catch (err) {
      setImportMessage({ kind: 'error', text: err instanceof RequestError ? err.message : String(err) });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="mono text-seal">加载失败：{error}</p>
        <Link href="/" className="btn btn-ghost mt-4">返回项目列表</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* 面包屑 */}
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">项目</Link>
        <span>/</span>
        <span className="text-ink">{project?.name ?? '…'}</span>
      </nav>

      {/* 项目头 */}
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b border-rule-strong pb-5">
        <div>
          <h1 className="h-display text-[24px]">{project?.name ?? '加载中…'}</h1>
          {project?.description && (
            <p className="mt-1 text-[13px] text-ink-2">{project.description}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <span className="mono rounded-xs bg-[var(--color-code-bg)] px-2 py-1 text-[12px] text-ink-2">
              {project ? mockPath(project.slug) : ''}
            </span>
            <CopyButton
              text={project ? mockPath(project.slug) : ''}
              label="复制 Mock 路径"
              className="btn btn-ghost !py-1 text-[12px]"
            />
            <span className="mono text-[11px] text-ink-3">
              前端 baseURL 指向 http://localhost:4000{project ? mockPath(project.slug) : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        {/* 左列：文档导入 + 文档历史 */}
        <section>
          <h2 className="eyebrow mb-3">导入文档</h2>
          <div className="card p-4">
            <form onSubmit={importFromUrl} className="flex flex-col gap-2.5">
              <label className="text-[12px] text-ink-2">从 URL 导入</label>
              <input
                className="field"
                type="url"
                required
                placeholder="https://…/swagger.json"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <button className="btn" disabled={importing || !importUrl}>
                {importing ? '导入中…' : '导入'}
              </button>
            </form>

            <div className="my-3.5 flex items-center gap-2 text-ink-3">
              <span className="h-px flex-1 bg-[var(--color-rule)]" />
              <span className="text-[11px]">或</span>
              <span className="h-px flex-1 bg-[var(--color-rule)]" />
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".json,.yaml,.yml"
              className="hidden"
              onChange={importFromFile}
            />
            <button
              className="btn btn-ghost w-full justify-center"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              上传文件（.json / .yaml）
            </button>

            {importMessage && (
              <p
                className="mono mt-3 text-[12px]"
                style={{
                  color:
                    importMessage.kind === 'error'
                      ? 'var(--color-seal)'
                      : importMessage.kind === 'warn'
                        ? 'var(--color-warn)'
                        : 'var(--color-ok)',
                }}
              >
                {importMessage.text}
              </p>
            )}
          </div>

          <h2 className="eyebrow mb-3 mt-7">文档历史</h2>
          <div className="card">
            {specs.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-ink-3">
                还没有导入文档
              </p>
            ) : (
              <ul>
                {specs.map((s) => (
                  <li key={s.id} className="border-b border-rule px-4 py-3 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono truncate text-[12px]" title={s.sourceUri}>
                        {s.sourceType === 'url' ? 'URL' : '文件'} · {basename(s.sourceUri)}
                      </span>
                      {s.isActive && (
                        <span
                          className="mono shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'var(--color-seal-soft)', color: 'var(--color-seal)' }}
                        >
                          生效中
                        </span>
                      )}
                    </div>
                    <p className="mono mt-1 text-[11px] text-ink-3">
                      OpenAPI {s.openapiVersion} · {formatDate(s.importedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 右列：路由账册 */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="eyebrow">路由表</h2>
            <span className="mono text-[11px] text-ink-3">{routes.length} 条</span>
          </div>
          <div className="card overflow-x-auto">
            {routes.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[13px] font-semibold">路由表是空的</p>
                <p className="mt-1 text-[12px] text-ink-2">
                  从左侧导入 Swagger / OpenAPI 文档，接口会自动出现在这里。
                </p>
              </div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="w-[76px]">方法</th>
                    <th>路径</th>
                    <th className="w-[70px]">语义</th>
                    <th className="w-[150px]">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id} className="cursor-pointer">
                      <td>
                        <MethodChip method={r.method} size="sm" />
                      </td>
                      <td>
                        <Link
                          href={`/projects/${projectId}/routes/${r.id}`}
                          className="mono text-[13px] text-ink hover:underline"
                        >
                          {r.path}
                        </Link>
                        {r.streaming && (
                          <span className="mono ml-2 rounded-xs bg-[var(--color-code-bg)] px-1.5 py-0.5 text-[10px] text-ink-2">
                            {r.streaming === 'upload' ? '上传' : r.streaming === 'download' ? '下载' : 'SSE'}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="mono text-[11px]"
                          style={{
                            color: r.crudKind !== 'none' ? 'var(--color-ink-2)' : 'var(--color-ink-3)',
                          }}
                        >
                          {CRUD_LABEL[r.crudKind] ?? r.crudKind}
                        </span>
                      </td>
                      <td className="truncate text-[12px] text-ink-2" title={r.summary}>
                        {r.summary || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function basename(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts[parts.length - 1] || uri;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
