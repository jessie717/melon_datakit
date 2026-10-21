'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, RequestError, type EntityRecord, type Project } from '@/lib/api';
import { ProjectNav } from '@/components/project-nav';
import { JsonView } from '@/components/json-view';

export default function DataPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [types, setTypes] = useState<Array<{ resourceType: string; count: number }>>([]);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [entities, setEntities] = useState<EntityRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pageSize = 20;

  const refreshTypes = useCallback(async () => {
    const [p, t] = await Promise.all([
      api.getProject(params.id),
      api.listEntityTypes(params.id),
    ]);
    setProject(p);
    setTypes(t);
    if (!activeType && t.length > 0) setActiveType(t[0]!.resourceType);
  }, [params.id, activeType]);

  const refreshEntities = useCallback(async () => {
    if (!activeType) {
      setEntities([]);
      return;
    }
    const res = await api.listEntities(params.id, activeType, page, pageSize);
    setEntities(res.items);
    setTotal(res.total);
  }, [params.id, activeType, page]);

  useEffect(() => {
    void refreshTypes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    void refreshEntities().catch(() => setEntities([]));
  }, [refreshEntities]);

  async function resetAll() {
    if (!activeType) return;
    if (!confirm(`确定重置「${activeType}」的全部数据？将回到种子状态。`)) return;
    await api.resetEntities(params.id, activeType);
    setMessage('已重置为种子数据');
    setPage(1);
    await Promise.all([refreshTypes(), refreshEntities()]);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">项目</Link>
        <span>/</span>
        <Link href={`/projects/${params.id}`} className="hover:text-ink hover:underline">
          {project?.name ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-ink">数据</span>
      </nav>

      <ProjectNav projectId={params.id} />

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        {/* 资源类型列表 */}
        <section>
          <h2 className="eyebrow mb-3">资源类型</h2>
          <div className="card">
            {types.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-ink-3">
                暂无数据 —— 访问 mock 接口后自动播种
              </p>
            ) : (
              <ul>
                {types.map((t) => (
                  <li key={t.resourceType}>
                    <button
                      className="flex w-full items-center justify-between border-b border-rule px-4 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-code-bg"
                      style={{
                        background: activeType === t.resourceType ? 'var(--color-code-bg)' : undefined,
                        fontWeight: activeType === t.resourceType ? 600 : 400,
                      }}
                      onClick={() => {
                        setActiveType(t.resourceType);
                        setPage(1);
                      }}
                    >
                      <span className="mono">{t.resourceType}</span>
                      <span className="mono text-[11px] text-ink-3">{t.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {activeType && (
            <button className="btn btn-ghost mt-4 w-full justify-center" onClick={resetAll}>
              重置「{activeType}」数据
            </button>
          )}
        </section>

        {/* 实体表格 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow">实体（{activeType ?? '未选择'}）</h2>
            <span className="mono text-[11px] text-ink-3">
              共 {total} 条 · 第 {page} 页
            </span>
          </div>

          {message && <p className="mono mb-3 text-[12px] text-ok">{message}</p>}

          <div className="card overflow-x-auto">
            {entities === null ? (
              <p className="mono px-4 py-8 text-center text-ink-3">加载中…</p>
            ) : entities.length === 0 ? (
              <p className="mono px-4 py-8 text-center text-ink-3">没有实体</p>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>主键</th>
                    <th>预览</th>
                    <th className="w-[80px]">更新时间</th>
                    <th className="w-[70px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((e) => (
                    <tr key={e.id}>
                      <td className="mono text-[12px]">{e.resourceKey}</td>
                      <td className="mono max-w-[360px] truncate text-[11px] text-ink-2">
                        {JSON.stringify(e.data).slice(0, 120)}
                      </td>
                      <td className="mono text-[11px] text-ink-3">
                        {new Date(e.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                      </td>
                      <td>
                        <button className="btn btn-ghost !py-1 text-[11px]" onClick={() => setEditing(e)}>
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {total > pageSize && (
            <div className="mt-3 flex items-center gap-2">
              <button
                className="btn btn-ghost !py-1 text-[12px]"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <button
                className="btn btn-ghost !py-1 text-[12px]"
                disabled={page * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <EditDialog
          projectId={params.id}
          entity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage('实体已更新');
            void refreshEntities();
          }}
        />
      )}
    </main>
  );
}

function EditDialog({
  projectId,
  entity,
  onClose,
  onSaved,
}: {
  projectId: string;
  entity: EntityRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(JSON.stringify(entity.data, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      await api.updateEntity(projectId, {
        resourceType: entity.resourceType,
        resourceKey: entity.resourceKey,
        data,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'JSON 格式错误' : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="card w-full max-w-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="h-display text-[15px]">
          编辑实体 <span className="mono text-ink-2">{entity.resourceKey}</span>
        </h3>
        <textarea
          className="field mono mt-3 min-h-[320px] text-[12px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="mono mt-2 text-[12px] text-seal">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
