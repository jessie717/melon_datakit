'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, mockPath, RequestError, type Project, type ProjectConfig } from '@/lib/api';
import { ProjectNav } from '@/components/project-nav';

export default function SettingsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api.getProject(params.id).then((p) => {
      setProject(p);
      setName(p.name);
      setSlug(p.slug);
      setDescription(p.description ?? '');
      setConfig(p.config);
    }).catch(() => {});
  }, [params.id]);

  async function save() {
    if (!config) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.updateProject(params.id, {
        name,
        slug,
        description,
        config,
      });
      setMessage({ kind: 'ok', text: '设置已保存（seedSalt 等即刻生效）' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof RequestError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function removeProject() {
    if (!confirm('确定删除整个项目？spec、规则、实体、日志将一并删除。')) return;
    await api.deleteProject(params.id);
    router.push('/');
  }

  if (!project || !config) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <p className="mono text-ink-3">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">项目</Link>
        <span>/</span>
        <Link href={`/projects/${params.id}`} className="hover:text-ink hover:underline">
          {project.name}
        </Link>
        <span>/</span>
        <span className="text-ink">设置</span>
      </nav>

      <ProjectNav projectId={params.id} />

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow mb-4">基本信息</h2>
          <div className="grid gap-4">
            <Field label="项目名称">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="项目标识（mountPath）">
              <input
                className="field"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9][a-z0-9-]*"
              />
              <p className="mono mt-1 text-[11px] text-ink-3">Mock 路径：{mockPath(slug)}</p>
            </Field>
            <Field label="描述">
              <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="eyebrow mb-4">Mock 行为</h2>
          <div className="grid gap-4">
            <Field label="数据语言">
              <select
                className="field"
                value={config.locale}
                onChange={(e) => setConfig({ ...config, locale: e.target.value as ProjectConfig['locale'] })}
              >
                <option value="zh_CN">中文</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="校验模式">
              <select
                className="field"
                value={config.validationMode}
                onChange={(e) =>
                  setConfig({ ...config, validationMode: e.target.value as ProjectConfig['validationMode'] })
                }
              >
                <option value="lenient">lenient — 放行并告警（默认）</option>
                <option value="strict">strict — 非法入参直接拒绝</option>
                <option value="off">off — 跳过校验</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="默认延迟（ms）">
                <input
                  className="field"
                  type="number"
                  min={0}
                  value={config.defaultLatencyMs}
                  onChange={(e) => setConfig({ ...config, defaultLatencyMs: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="默认错误率">
                <input
                  className="field"
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={config.defaultErrorRate}
                  onChange={(e) => setConfig({ ...config, defaultErrorRate: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="日志保留天数">
                <input
                  className="field"
                  type="number"
                  min={1}
                  value={config.logRetentionDays}
                  onChange={(e) => setConfig({ ...config, logRetentionDays: Number(e.target.value) || 7 })}
                />
              </Field>
              <Field label="种子数据条数">
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={100}
                  value={config.seedEntitiesCount}
                  onChange={(e) => setConfig({ ...config, seedEntitiesCount: Number(e.target.value) || 10 })}
                />
              </Field>
            </div>
            <Field label="Seed 盐值（改动会改变所有生成数据）">
              <input
                className="field"
                value={config.seedSalt}
                onChange={(e) => setConfig({ ...config, seedSalt: e.target.value })}
              />
            </Field>
          </div>
        </section>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? '保存中…' : '保存设置'}
        </button>
        {message && (
          <span className="mono text-[12px]" style={{ color: message.kind === 'ok' ? 'var(--color-ok)' : 'var(--color-seal)' }}>
            {message.text}
          </span>
        )}
      </div>

      <section className="card mt-10 border-[var(--color-seal)] p-5">
        <h2 className="eyebrow mb-2" style={{ color: 'var(--color-seal)' }}>危险操作</h2>
        <p className="text-[12px] text-ink-2">删除项目会移除它的全部 spec、规则、实体与日志，不可恢复。</p>
        <button
          className="btn mt-3"
          style={{ background: 'var(--color-seal)', borderColor: 'var(--color-seal)' }}
          onClick={removeProject}
        >
          删除项目
        </button>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow block pb-1.5">{label}</span>
      {children}
    </label>
  );
}
