'use client';

import { useEffect, useState } from 'react';
import { api, RequestError, type MockRule, type RouteModel } from '@/lib/api';

/**
 * Mock 规则编辑器 —— 按路由配置延迟/错误/覆盖。
 * bodyStatic / bodyPatch / fieldOverrides 用 JSON 文本编辑（MVP）。
 */
export function RuleEditor({ projectId, route }: { projectId: string; route: RouteModel }) {
  const [rule, setRule] = useState<Partial<MockRule> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listRules(projectId)
      .then((rules) => {
        if (!alive) return;
        const found = rules.find((r) => r.method === route.method && r.path === route.path);
        setRule(found ?? { enabled: true, fieldOverrides: [] });
        setLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setRule({ enabled: true, fieldOverrides: [] });
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [projectId, route.method, route.path]);

  async function save() {
    if (!rule) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: Partial<MockRule> & { method: string; path: string } = {
        method: route.method,
        path: route.path,
        enabled: rule.enabled ?? true,
        ...(rule.latencyMs != null ? { latencyMs: rule.latencyMs } : {}),
        ...(rule.errorRate != null ? { errorRate: rule.errorRate } : {}),
        ...(rule.errorStatus != null ? { errorStatus: rule.errorStatus } : {}),
        ...(rule.statusOverride != null ? { statusOverride: rule.statusOverride } : {}),
        ...(rule.seed != null ? { seed: rule.seed } : {}),
        ...(rule.validationMode ? { validationMode: rule.validationMode } : {}),
        ...(rule.bodyStatic !== undefined ? { bodyStatic: rule.bodyStatic } : {}),
        ...(rule.bodyPatch !== undefined ? { bodyPatch: rule.bodyPatch } : {}),
        fieldOverrides: rule.fieldOverrides ?? [],
        ...(rule.note ? { note: rule.note } : {}),
      };
      const saved = await api.upsertRule(projectId, body);
      setRule(saved);
      setMessage('规则已保存，即刻生效');
    } catch (err) {
      setMessage(err instanceof RequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule?.id) return;
    setBusy(true);
    try {
      await api.deleteRule(projectId, rule.id);
      setRule({ enabled: true, fieldOverrides: [] });
      setMessage('规则已删除');
    } catch (err) {
      setMessage(err instanceof RequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !rule) {
    return <p className="mono py-4 text-[12px] text-ink-3">加载规则…</p>;
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="eyebrow">Mock 规则</h2>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={rule.enabled ?? true}
            onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
          />
          启用
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="延迟（ms）">
          <input
            className="field"
            type="number"
            min={0}
            max={60000}
            value={rule.latencyMs ?? ''}
            onChange={(e) => setRule({ ...rule, latencyMs: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="错误率（0~1）">
          <input
            className="field"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={rule.errorRate ?? ''}
            onChange={(e) => setRule({ ...rule, errorRate: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="错误状态码">
          <input
            className="field"
            type="number"
            min={100}
            max={599}
            value={rule.errorStatus ?? ''}
            onChange={(e) => setRule({ ...rule, errorStatus: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="强制状态码">
          <input
            className="field"
            type="number"
            min={100}
            max={599}
            value={rule.statusOverride ?? ''}
            onChange={(e) => setRule({ ...rule, statusOverride: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="固定 seed">
          <input
            className="field"
            type="number"
            value={rule.seed ?? ''}
            onChange={(e) => setRule({ ...rule, seed: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="校验模式">
          <select
            className="field"
            value={rule.validationMode ?? ''}
            onChange={(e) =>
              setRule({ ...rule, validationMode: (e.target.value || undefined) as MockRule['validationMode'] })
            }
          >
            <option value="">跟随项目</option>
            <option value="strict">strict（拒绝）</option>
            <option value="lenient">lenient（放行告警）</option>
            <option value="off">off（跳过）</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="bodyStatic（整响应 JSON，留空不启用）">
          <textarea
            className="field mono min-h-[90px]"
            placeholder='{"code":0,"data":[]}'
            value={typeof rule.bodyStatic === 'string' ? rule.bodyStatic : rule.bodyStatic != null ? JSON.stringify(rule.bodyStatic, null, 2) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (!raw.trim()) return setRule({ ...rule, bodyStatic: undefined });
              try {
                setRule({ ...rule, bodyStatic: JSON.parse(raw) });
              } catch {
                /* 输入过程中暂存无效 JSON — 不打断编辑 */
              }
            }}
          />
        </Field>
        <Field label="字段覆盖（JSON 数组，路径 + 生成器）">
          <textarea
            className="field mono min-h-[90px]"
            placeholder='[{"path":"data.items","generator":{"kind":"literal","value":[]}}]'
            value={JSON.stringify(rule.fieldOverrides ?? [], null, 2)}
            onChange={(e) => {
              try {
                setRule({ ...rule, fieldOverrides: JSON.parse(e.target.value) as MockRule['fieldOverrides'] });
              } catch {
                /* 编辑中 */
              }
            }}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? '保存中…' : '保存规则'}
        </button>
        {rule.id && (
          <button className="btn btn-ghost" disabled={busy} onClick={remove}>
            删除规则
          </button>
        )}
        {message && <span className="mono text-[12px] text-ink-2">{message}</span>}
      </div>
    </section>
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
