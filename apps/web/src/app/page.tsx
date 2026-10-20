import type { HealthResponse } from '@datakit/shared';

export const dynamic = 'force-dynamic';

async function getHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(
      `${process.env.INTERNAL_SERVER_ORIGIN ?? 'http://localhost:4000'}/_datakit/admin/health`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const health = await getHealth();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">melon_datakit</h1>
        <p className="mt-1 text-sm text-gray-500">
          OpenAPI 驱动的 Mock 数据服务平台 —— 自动生成、状态化 CRUD、流式处理
        </p>
      </header>

      <section className="rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-medium text-gray-600">服务状态</h2>
        {health ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-gray-500">API</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    health.ok
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      health.ok ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  正常
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">数据库</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    health.db === 'up'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      health.db === 'up' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  {health.db === 'up' ? '已连接' : '未连接'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">版本</dt>
              <dd className="mt-1 font-mono text-xs">{health.version}</dd>
            </div>
            <div>
              <dt className="text-gray-500">运行时长</dt>
              <dd className="mt-1 text-xs">{health.uptimeSec}s</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-red-600">
            无法连接服务端（Elysia，端口 4000）。请确认已启动 server 进程。
          </p>
        )}
      </section>

      <section className="mt-8 rounded-lg border border-dashed border-gray-300 p-6">
        <h2 className="text-sm font-medium text-gray-600">项目列表</h2>
        <p className="mt-2 text-sm text-gray-500">
          Phase 6 接入 —— 此处将展示项目卡片、spec 状态与快捷操作。
        </p>
      </section>
    </main>
  );
}
