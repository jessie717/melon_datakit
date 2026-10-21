/**
 * Mock Dispatcher —— 接收 /p/:slug/** 的全部 mock 流量。
 *
 * Phase 1：路径匹配 + 路由命中返回 501 占位（Phase 2 接管生成）。
 * 纯 fetch handler，可被 Elysia mount，也可独立测试。
 */
import type { RouteModel } from '@datakit/shared';
import { getProject, matchRoute, nearestRoutes } from './registry';

const MOUNT_RE = /^\/p\/([^/]+)(\/.*)?$/;

export interface DispatchResult {
  matched: boolean;
  slug?: string;
  route?: RouteModel;
  params?: Record<string, string>;
  /** 用于日志的错误信息 */
  error?: string;
  status: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 解析挂载路径 → slug + 路由匹配 */
export function dispatch(url: URL, method: string): DispatchResult {
  const m = MOUNT_RE.exec(url.pathname);
  if (!m) {
    return {
      matched: false,
      status: 404,
      error: `mock 流量应走 /p/{项目标识}/… 形式，收到 ${url.pathname}`,
    };
  }
  const slug = m[1]!;
  const rest = m[2] ?? '/';

  const project = getProject(slug);
  if (!project) {
    return {
      matched: false,
      slug,
      status: 404,
      error: `项目 "${slug}" 不存在或尚未导入 spec`,
    };
  }

  const hit = matchRoute(slug, method, rest);
  if (!hit) {
    return {
      matched: false,
      slug,
      status: 404,
      error: `无匹配路由 ${method.toUpperCase()} ${rest}`,
    };
  }

  return {
    matched: true,
    slug,
    route: hit.route,
    params: hit.params,
    status: 200,
  };
}

/** Elysia mount 用的 fetch handler */
export function mockHandler(request: Request): Response {
  const url = new URL(request.url);
  const result = dispatch(url, request.method);

  if (!result.matched) {
    // 项目存在但路由不匹配 → 附带最接近路由提示
    const hints =
      result.error?.startsWith('无匹配路由') && result.slug
        ? nearestRoutes(result.slug, request.method, url.pathname.replace(`/p/${result.slug}`, ''))
        : [];

    return json(404, {
      error: result.error?.startsWith('无匹配路由') ? 'route_not_found' : 'not_found',
      message: result.error,
      ...(hints.length > 0 ? { nearest: hints } : {}),
    });
  }

  // Phase 2：在此接 mock 生成管线（校验 → 故障注入 → 状态 CRUD / 生成）
  return json(501, {
    error: 'mock_generation_pending',
    message: '路由已匹配，mock 生成引擎将在 Phase 2 启用',
    route: {
      method: result.route!.method,
      path: result.route!.path,
      operationId: result.route!.operationId,
    },
  });
}
