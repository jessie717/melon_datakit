/**
 * melon_datakit server 入口。
 *
 * 路由布局：
 *   /_datakit/admin/**  管理控制台 API（显式路由）
 *   /_datakit/stream    SSE 实时推送（Phase 6）
 *   /p/:slug/**         mock 流量（Mock Dispatcher）
 */
import './env';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import type { HealthResponse } from '@datakit/shared';
import { closeDb, pingDb } from './db/client';
import { adminRoutes } from './admin';
import { mockHandler } from './engine/dispatch';
import { bootstrapRegistry } from './engine/bootstrap';

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
  // 管理控制台 API
  .use(adminRoutes)
  // Mock Dispatcher —— 全部 mock 流量
  .all('/p/*', ({ request }) => mockHandler(request))
  .onError(({ code, error, set }) => {
    set.status = code === 'NOT_FOUND' ? 404 : 500;
    return {
      error: code === 'NOT_FOUND' ? 'not_found' : 'internal_error',
      message: String(error),
    };
  });

// 启动：先预热路由表，再 listen
try {
  await bootstrapRegistry();
} catch (err) {
  console.warn(`[datakit] 路由表预热失败（数据库未就绪？）：${String(err)}`);
}

app.listen(PORT);

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
