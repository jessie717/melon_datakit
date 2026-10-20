/**
 * melon_datakit server 入口。
 *
 * 路由布局：
 *   /_datakit/admin/**  管理控制台 API（显式路由）
 *   /_datakit/stream    SSE 实时推送
 *   /p/:slug/**         mock 流量（Mock Dispatcher catch-all）
 */
import './env';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import type { HealthResponse } from '@datakit/shared';
import { closeDb, pingDb } from './db/client';

const PORT = Number(process.env.SERVER_PORT ?? 4000);
const startedAt = Date.now();

const app = new Elysia()
  .use(cors())
  .get('/_datakit/admin/health', async (): Promise<HealthResponse> => {
    return {
      ok: true,
      version: '0.1.0',
      db: (await pingDb()) ? 'up' : 'down',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    };
  })
  // Mock Dispatcher 占位 —— Phase 1 接入 spec 路由表后接管
  .all('/p/*', () => {
    return new Response(
      JSON.stringify({
        error: 'mock_dispatcher_not_ready',
        message: 'Spec 尚未导入，mock dispatcher 在 Phase 1 启用',
      }),
      { status: 501, headers: { 'content-type': 'application/json' } }
    );
  })
  .onError(({ code, error, set }) => {
    set.status = code === 'NOT_FOUND' ? 404 : 500;
    return {
      error: code === 'NOT_FOUND' ? 'not_found' : 'internal_error',
      message: String(error),
    };
  })
  .listen(PORT);

console.log(`[datakit] server listening on http://localhost:${PORT}`);
console.log(`[datakit] admin health: http://localhost:${PORT}/_datakit/admin/health`);

// 优雅退出
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log(`\n[datakit] ${sig} received, shutting down…`);
    await closeDb();
    process.exit(0);
  });
}

export type App = typeof app;
