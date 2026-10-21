'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, mockPath, RequestError, type Project, type RouteModel } from '@/lib/api';
import { MethodChip } from '@/components/method-chip';
import { JsonView, SchemaBadge } from '@/components/json-view';
import { StreamPanel } from '@/components/stream-panel';

const CRUD_LABEL: Record<string, string> = {
  list: '列表',
  create: '创建',
  get: '详情',
  update: '更新',
  delete: '删除',
  none: '—',
};

export default function RouteDetailPage() {
  const params = useParams<{ id: string; routeId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [route, setRoute] = useState<RouteModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, routes] = await Promise.all([
          api.getProject(params.id),
          api.listRoutes(params.id),
        ]);
        if (!alive) return;
        setProject(p);
        const found = routes.find((r) => r.id === params.routeId) ?? null;
        setRoute(found);
        if (!found) setError('路由不存在（可能文档已重新导入）');
      } catch (err) {
        if (alive) setError(err instanceof RequestError ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.id, params.routeId]);

  if (error || (project && !route)) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="mono text-seal">{error ?? '路由不存在'}</p>
        <Link href={`/projects/${params.id}`} className="btn btn-ghost mt-4">
          返回项目
        </Link>
      </main>
    );
  }

  const query = route?.params.filter((p) => p.in === 'query') ?? [];
  const pathParams = route?.params.filter((p) => p.in === 'path') ?? [];
  const headers = route?.params.filter((p) => p.in === 'header') ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline">项目</Link>
        <span>/</span>
        <Link href={`/projects/${params.id}`} className="hover:text-ink hover:underline">
          {project?.name ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-ink">路由</span>
      </nav>

      {/* 路由签名头 */}
      <div className="mb-7 border-b border-rule-strong pb-5">
        <div className="flex flex-wrap items-center gap-3">
          {route && <MethodChip method={route.method} />}
          <h1 className="mono h-display text-[20px] break-all">{route?.path ?? '…'}</h1>
        </div>
        {route?.summary && <p className="mt-2 text-[13px] text-ink-2">{route.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          {route?.operationId && (
            <span className="mono text-[11px] text-ink-3">operationId: {route.operationId}</span>
          )}
          {route?.crud && route.crud.kind !== 'none' && (
            <span className="mono text-[11px] text-ink-3">
              语义: {CRUD_LABEL[route.crud.kind]}{route.crud.resourceType ? ` · ${route.crud.resourceType}` : ''}
            </span>
          )}
          {route?.streaming && (
            <span className="mono text-[11px] text-ink-3">
              流式: {route.streaming === 'upload' ? '上传' : route.streaming === 'download' ? '下载' : 'SSE'}
            </span>
          )}
          <span className="mono text-[11px] text-ink-3">
            成功响应: {route?.successStatus ?? '—'}
          </span>
        </div>
        <p className="mono mt-3 text-[11px] text-ink-3">
          请求示例: GET http://localhost:4000{project ? mockPath(project.slug) : ''}
          {route?.path ?? ''}
        </p>
      </div>

      {!route ? (
        <p className="mono py-10 text-center text-ink-3">加载中…</p>
      ) : (
        <div className="grid gap-7">
          {/* 请求 */}
          <section>
            <h2 className="eyebrow mb-3">请求</h2>
            <div className="grid gap-5">
              {pathParams.length > 0 && (
                <ParamTable title="路径参数" params={pathParams} />
              )}
              {query.length > 0 && <ParamTable title="查询参数" params={query} />}
              {headers.length > 0 && <ParamTable title="请求头" params={headers} />}

              {route.requestBody ? (
                <div className="card p-4">
                  <div className="mb-2.5 flex items-center gap-3">
                    <h3 className="text-[13px] font-semibold">请求体</h3>
                    <span className="mono text-[11px] text-ink-3">
                      {route.requestBody.contentType}
                      {route.requestBody.required ? ' · 必填' : ''}
                    </span>
                  </div>
                  <JsonView value={route.requestBody.schema} maxHeight={260} />
                </div>
              ) : (
                <p className="text-[12px] text-ink-3">无请求体</p>
              )}
            </div>
          </section>

          {/* 响应 */}
          <section>
            <h2 className="eyebrow mb-3">响应</h2>
            <div className="grid gap-5">
              {route.responses.length === 0 && (
                <p className="text-[12px] text-ink-3">文档未定义响应结构</p>
              )}
              {route.responses.map((res) => (
                <div key={res.status} className="card p-4">
                  <div className="mb-2.5 flex items-center gap-3">
                    <StatusChip status={res.status} />
                    <span className="mono text-[11px] text-ink-3">{res.contentType}</span>
                  </div>
                  <JsonView value={res.schema} maxHeight={220} />
                  {res.example !== undefined && (
                    <>
                      <h4 className="eyebrow mb-2 mt-4">文档示例</h4>
                      <JsonView value={res.example} maxHeight={180} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 流式操作 / 试调 */}
          {route.streaming && project ? (
            <StreamPanel
              kind={route.streaming}
              mockUrl={`http://localhost:4000${mockPath(project.slug)}${route.path}`}
            />
          ) : (
            <section className="card border-dashed p-5">
              <h2 className="eyebrow mb-2">试调</h2>
              <p className="text-[12px] text-ink-2">
                可直接请求 mock 地址查看生成数据：
                <span className="mono ml-1 text-ink">
                  http://localhost:4000{project ? mockPath(project.slug) : ''}
                  {route.path}
                </span>
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function ParamTable({
  title,
  params,
}: {
  title: string;
  params: Array<{ name: string; required: boolean; schema: Record<string, unknown> }>;
}) {
  return (
    <div className="card">
      <div className="border-b border-rule px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th className="w-[36%]">名称</th>
            <th className="w-[22%]">类型</th>
            <th>约束</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name}>
              <td className="mono text-[12px]">
                {p.name}
                {p.required && <span className="ml-1 text-seal">*</span>}
              </td>
              <td><SchemaBadge schema={p.schema} /></td>
              <td className="mono text-[11px] text-ink-3">{constraintText(p.schema)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ status }: { status: number }) {
  const style =
    status < 300
      ? { background: 'var(--color-get-soft)', color: 'var(--color-get)' }
      : status < 500
        ? { background: 'var(--color-put-soft)', color: 'var(--color-put)' }
        : { background: 'var(--color-seal-soft)', color: 'var(--color-seal)' };
  return (
    <span
      className="mono rounded-xs px-2 py-0.5 text-[11px] font-semibold"
      style={style}
    >
      {status}
    </span>
  );
}

function constraintText(schema: Record<string, unknown>): string {
  const bits: string[] = [];
  if (schema['enum']) bits.push(`enum: ${(schema['enum'] as unknown[]).join(' | ')}`);
  if (schema['minimum'] !== undefined) bits.push(`≥ ${schema['minimum']}`);
  if (schema['maximum'] !== undefined) bits.push(`≤ ${schema['maximum']}`);
  if (schema['minLength'] !== undefined) bits.push(`minLen ${schema['minLength']}`);
  if (schema['maxLength'] !== undefined) bits.push(`maxLen ${schema['maxLength']}`);
  return bits.join(' · ') || '—';
}
