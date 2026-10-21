/**
 * 内存路由表 —— spec 热更新的关键。
 *
 * dispatcher 每次请求都从这里取路由表；spec 导入/重导入时只重建这里，
 * 不动 Elysia 实例。这是选 Dispatcher 而非 app.route() 逐条注册的核心理由。
 */
import { buildMatcher } from '@datakit/core';
import type { HttpMethod, RouteModel } from '@datakit/shared';

export interface ProjectRegistry {
  projectId: string;
  slug: string;
  routes: RouteModel[];
  matcher: ReturnType<typeof buildMatcher>;
  /** method + ' ' + 模板路径 → RouteModel */
  byKey: Map<string, RouteModel>;
}

const bySlug = new Map<string, ProjectRegistry>();

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** 重建某项目的路由表（spec 导入/重导入后调用） */
export function rebuildProject(
  projectId: string,
  slug: string,
  routes: RouteModel[]
): ProjectRegistry {
  const matcher = buildMatcher(routes.map((r) => ({ method: r.method, path: r.path })));
  const byKey = new Map<string, RouteModel>();
  for (const r of routes) {
    byKey.set(routeKey(r.method, r.path), r);
  }
  const registry: ProjectRegistry = { projectId, slug, routes, matcher, byKey };
  bySlug.set(slug, registry);
  return registry;
}

export function getProject(slug: string): ProjectRegistry | undefined {
  return bySlug.get(slug);
}

export function dropProject(slug: string): void {
  bySlug.delete(slug);
}

export function listProjects(): ProjectRegistry[] {
  return [...bySlug.values()];
}

/** 匹配请求 → 命中的 RouteModel + 路径参数 */
export function matchRoute(
  slug: string,
  method: string,
  path: string
): { route: RouteModel; params: Record<string, string> } | null {
  const registry = bySlug.get(slug);
  if (!registry) return null;
  const hit = registry.matcher.match(method as HttpMethod, path);
  if (!hit) return null;
  const route = registry.byKey.get(routeKey(method, hit.template));
  if (!route) return null;
  return { route, params: hit.params };
}

/**
 * 最接近路由提示（404 时友好提示用）。
 * 简单策略：同 method 下按模板分段重合度排序，取前 3。
 */
export function nearestRoutes(
  slug: string,
  method: string,
  path: string,
  limit = 3
): Array<{ method: string; path: string }> {
  const registry = bySlug.get(slug);
  if (!registry) return [];
  const parts = new Set(path.split('/').filter(Boolean));

  return registry.routes
    .filter((r) => r.method === method.toUpperCase())
    .map((r) => {
      const rp = r.path.split('/').filter(Boolean);
      const overlap = rp.filter((seg) => parts.has(seg) || /^\{.*\}$/.test(seg)).length;
      return { method: r.method, path: r.path, score: overlap / Math.max(rp.length, 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ method: m, path: p }) => ({ method: m, path: p }));
}
