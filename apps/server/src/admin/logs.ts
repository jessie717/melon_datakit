/**
 * 管理 API —— 请求日志查询 / 实时流 / 清空。
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, sql } from 'drizzle-orm';
import { sse } from 'elysia';
import type { LogListResponse, RequestLogEntry } from '@datakit/shared';
import { db } from '../db/client';
import { requestLogs } from '../db/schema';
import { cleanupLogs } from '../engine/log';
import { subscribe } from '../engine/logbus';
import { getProjectRow } from './projects';

function toLogDto(row: typeof requestLogs.$inferSelect): RequestLogEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    method: row.method,
    path: row.path,
    query: row.query as Record<string, string>,
    headers: row.headers as Record<string, string>,
    ...(row.requestBody != null ? { requestBody: row.requestBody } : {}),
    status: row.status,
    ...(row.responseBody != null ? { responseBody: row.responseBody } : {}),
    latencyMs: row.latencyMs,
    ...(row.matchedRouteId ? { matchedRouteId: row.matchedRouteId } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.seed != null ? { seed: row.seed } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export const logsAdmin = new Elysia({ prefix: '/_datakit/admin' })
  .get(
    '/projects/:id/logs',
    async ({ params, query, set }): Promise<LogListResponse | { error: string; message: string }> => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const page = Math.max(1, Number(query.page ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 50) || 50));

      const conditions = [eq(requestLogs.projectId, params.id)];
      if (query.method) conditions.push(eq(requestLogs.method, query.method.toUpperCase()));
      if (query.status) conditions.push(eq(requestLogs.status, Number(query.status)));

      const where = and(...conditions);
      const [cnt] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(requestLogs)
        .where(where);
      const rows = await db
        .select()
        .from(requestLogs)
        .where(where)
        .orderBy(desc(requestLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        total: cnt?.n ?? 0,
        page,
        pageSize,
        items: rows.map(toLogDto),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        method: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  // 实时日志流（SSE）
  .get('/projects/:id/stream', async ({ params, set, request }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        // 连接即发一条 hello（前端可据此确认连接）
        controller.enqueue(
          encoder.encode(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`)
        );
        const unsubscribe = subscribe(params.id, (entry) => {
          try {
            controller.enqueue(
              encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
            );
          } catch {
            unsubscribe();
          }
        });
        request.signal?.addEventListener('abort', () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      },
    });
  })
  // 清空日志（手动）
  .delete('/projects/:id/logs', async ({ params, set }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    const deleted = await db
      .delete(requestLogs)
      .where(eq(requestLogs.projectId, params.id))
      .returning({ id: requestLogs.id });
    return { ok: true, deleted: deleted.length };
  })
  // 立即触发一次全量清理
  .post('/logs/cleanup', async () => {
    const deleted = await cleanupLogs();
    return { ok: true, deleted };
  });

export type LogsAdmin = typeof logsAdmin;
