'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, mockPath, RequestError, type Project } from '@/lib/api';
import { CopyButton } from '@/components/copy-button';

interface Health {
  ok: boolean;
  version: string;
  db: string;
  uptimeSec: number;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, list] = await Promise.all([api.health(), api.listProjects()]);
      setHealth(h);
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await api.createProject({ name, slug, description: description || undefined });
      setName('');
      setSlug('');
      setDescription('');
      setShowForm(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* 状态条 */}
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule pb-4">
        <span className="eyebrow">STATUS</span>
        <StatusItem label="服务" ok={health?.ok ?? null} okText="正常" />
        <StatusItem label="数据库" ok={health?.db === 'up' ? true : health ? false : null} okText="已连接" />
        {health && (
          <span className="mono text-[11px] text-ink-3">
            v{health.version} · 已运行 {formatUptime(health.uptimeSec)}
          </span>
        )}
        {error && (
          <span className="mono text-[11px] text-seal">
            无法连接服务端：{error}
          </span>
        )}
      </div>

      {/* 标题 + 主操作 */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="h-display text-[26px]">项目</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            每个项目挂载独立的 Mock 地址，导入 OpenAPI 文档即可开始调试
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '取消' : '新建项目'}
        </button>
      </div>

      {/* 新建表单 */}
      {showForm && (
        <form className="card mb-8 p-5" onSubmit={handleCreate}>
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <label className="block">
              <span className="eyebrow block pb-1.5">项目名称</span>
              <input
                className="field"
                required
                maxLength={100}
                placeholder="如：商城前端"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // 名称 → slug 自动建议（仅当 slug 未手动改过或为空）
                  if (!slug || slug === toSlug(name)) setSlug(toSlug(e.target.value));
                }}
              />
            </label>
            <label className="block">
              <span className="eyebrow block pb-1.5">项目标识（mountPath）</span>
              <input
                className="field"
                required
                maxLength={63}
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="shop-web"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="eyebrow block pb-1.5">描述（可选）</span>
            <input
              className="field"
              maxLength={500}
              placeholder="一句话说明这个项目是干什么的"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {formError && (
            <p className="mono mt-3 text-[12px] text-seal">{formError}</p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button className="btn" disabled={creating || !name || !slug}>
              {creating ? '创建中…' : '创建项目'}
            </button>
            {slug && (
              <span className="mono text-[11px] text-ink-3">
                创建后 Mock 地址：{mockPath(slug)}
              </span>
            )}
          </div>
        </form>
      )}

      {/* 项目账册 */}
      {projects === null && !error ? (
        <p className="mono py-10 text-center text-[12px] text-ink-3">加载中…</p>
      ) : projects && projects.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          {/* 空态：行动指引，不是情绪 */}
          <span className="seal-mark h-9 w-9 text-[13px] opacity-40">DK</span>
          <p className="text-[14px] font-semibold">还没有项目</p>
          <p className="max-w-sm text-[13px] text-ink-2">
            创建一个项目，导入 Swagger / OpenAPI 文档，前端就能连上 Mock 地址调试了。
          </p>
          {!showForm && (
            <button className="btn mt-1" onClick={() => setShowForm(true)}>
              新建项目
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${project.id}`} className="h-display block truncate text-[16px] hover:underline">
            {project.name}
          </Link>
          <p className="mono mt-1 text-[12px] text-ink-2">
            {mockPath(project.slug)}
          </p>
        </div>
        {/* 签名元素：朱印 —— 已生效状态 */}
        <span
          className="mono shrink-0 rounded-xs px-2 py-1 text-[10px] font-semibold tracking-[0.08em]"
          style={{ background: 'var(--color-seal-soft)', color: 'var(--color-seal)' }}
        >
          已生效
        </span>
      </div>

      {project.description && (
        <p className="mt-3 line-clamp-2 text-[13px] text-ink-2">
          {project.description}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
        <Link href={`/projects/${project.id}`} className="btn btn-ghost py-1.5! text-[12px]">
          打开
        </Link>
        <CopyButton
          text={mockPath(project.slug)}
          label="复制 Mock 路径"
          className="btn btn-ghost py-1.5! text-[12px]"
        />
      </div>
    </div>
  );
}

function StatusItem({ label, ok, okText }: { label: string; ok: boolean | null; okText: string }) {
  const color = ok === null ? 'var(--color-ink-3)' : ok ? 'var(--color-ok)' : 'var(--color-seal)';
  const text = ok === null ? '检测中' : ok ? okText : '异常';
  return (
    <span className="flex items-center gap-2 text-[12px]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="text-ink-2">{label}</span>
      <span className="mono font-semibold" style={{ color }}>
        {text}
      </span>
    </span>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
}

function toSlug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
