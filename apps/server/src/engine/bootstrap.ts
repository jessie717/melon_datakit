/**
 * 启动预热 —— 从 DB 加载所有 active spec 的路由表进内存。
 * 进程重启后 dispatcher 立即可用，无需重新导入 spec。
 */
import { eq, sql } from 'drizzle-orm';
import type { RouteModel } from '@datakit/shared';
import { db } from '../db/client';
import { projects, routes, specs } from '../db/schema';
import { rebuildProject } from './registry';

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
    ...(req['body'] ? { requestBody: req['body'] as RouteModel['requestBody'] } : {}),
    responses,
    successStatus: row.successStatus,
    ...(row.streamKind ? { streaming: row.streamKind as RouteModel['streaming'] } : {}),
    ...(row.crud ? { crud: row.crud as unknown as RouteModel['crud'] } : {}),
    schemaHash: row.schemaHash,
  };
}

export async function bootstrapRegistry(): Promise<void> {
  const rows = await db
    .select({
      projectId: projects.id,
      slug: projects.slug,
      config: projects.config,
      route: routes,
    })
    .from(projects)
    .innerJoin(specs, eq(specs.projectId, projects.id))
    .innerJoin(routes, eq(routes.specId, specs.id))
    .where(eq(specs.isActive, true));

  const grouped = new Map<
    string,
    { projectId: string; slug: string; seedSalt: string; routes: RouteModel[] }
  >();
  for (const row of rows) {
    const entry = grouped.get(row.projectId) ?? {
      projectId: row.projectId,
      slug: row.slug,
      seedSalt: (row.config as { seedSalt?: string })?.seedSalt ?? 'datakit-dev-salt',
      routes: [],
    };
    entry.routes.push(rowToRouteModel(row.route));
    grouped.set(row.projectId, entry);
  }

  for (const entry of grouped.values()) {
    rebuildProject(entry.projectId, entry.slug, entry.routes, entry.seedSalt);
    console.log(
      `[datakit] 已加载项目 ${entry.slug} 的路由表（${entry.routes.length} 条路由）`
    );
  }
  if (grouped.size > 0) {
    console.log(`[datakit] 路由表预热完成：${grouped.size} 个项目`);
  }
}
