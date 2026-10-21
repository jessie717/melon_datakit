/**
 * 管理 API —— 路由表查询（/_datakit/admin/projects/:id/routes）。
 */
import { Elysia } from 'elysia';
import { and, eq, asc } from 'drizzle-orm';
import type { RouteModel, RouteSummary } from '@datakit/shared';
import { db } from '../db/client';
import { routes, specs } from '../db/schema';
import { getProjectRow } from './projects';

function rowToRouteModel(row: typeof routes.$inferSelect): RouteModel {
  const req = row.requestSchema as Record<string, unknown>;
  const resMap = row.responseSchema as Record<string, Record<string, unknown>>;

  const params = [
    ...((req['params'] as RouteModel['params']) ?? []),
    ...((req['query'] as RouteModel['params']) ?? []),
    ...((req['headers'] as RouteModel['params']) ?? []),
  ];

  const responses = Object.entries(resMap ?? {}).map(([status, entry]) => ({
    status: Number(status),
    contentType: (entry['contentType'] as string) ?? 'application/json',
    schema: (entry['schema'] as Record<string, unknown>) ?? {},
    ...(entry['example'] !== undefined ? { example: entry['example'] } : {}),
  }));

  return {
    id: row.id,
    method: row.method as RouteModel['method'],
    path: row.path,
    ...(row.operationId ? { operationId: row.operationId } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    tags: (row.tags as string[]) ?? [],
    params,
    ...(req['body']
      ? { requestBody: req['body'] as RouteModel['requestBody'] }
      : {}),
    responses,
    successStatus: row.successStatus,
    ...(row.streamKind ? { streaming: row.streamKind as RouteModel['streaming'] } : {}),
    ...(row.crud ? { crud: row.crud as unknown as RouteModel['crud'] } : {}),
    schemaHash: row.schemaHash,
  };
}

export const routesAdmin = new Elysia({ prefix: '/_datakit/admin' })
  // 轻量摘要（UI 列表页）
  .get(
    '/projects/:id/routes/summary',
    async ({ params, set }): Promise<RouteSummary[] | { error: string; message: string }> => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const rows = await db
        .select()
        .from(routes)
        .innerJoin(specs, eq(routes.specId, specs.id))
        .where(and(eq(specs.projectId, params.id), eq(specs.isActive, true)));
      return rows
        .map((r) => r.routes)
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
        .map((r) => ({
          id: r.id,
          method: r.method as RouteSummary['method'],
          path: r.path,
          ...(r.summary ? { summary: r.summary } : {}),
          tags: (r.tags as string[]) ?? [],
          crudKind: ((r.crud as { kind?: string })?.kind ?? 'none') as RouteSummary['crudKind'],
          ...(r.streamKind ? { streaming: r.streamKind as RouteSummary['streaming'] } : {}),
        }));
    }
  )
  // 完整路由（含 schema，试调/规则编辑用）
  .get(
    '/projects/:id/routes',
    async ({ params, set }): Promise<RouteModel[] | { error: string; message: string }> => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const rows = await db
        .select()
        .from(routes)
        .innerJoin(specs, eq(routes.specId, specs.id))
        .where(and(eq(specs.projectId, params.id), eq(specs.isActive, true)))
        .orderBy(asc(routes.path), asc(routes.method));
      return rows.map((r) => rowToRouteModel(r.routes));
    }
  );

export type RoutesAdmin = typeof routesAdmin;
