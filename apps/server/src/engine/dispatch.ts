/**
 * Mock Dispatcher —— 接收 /p/:slug/** 的全部 mock 流量。
 *
 * 管线：路径匹配 → 响应装配（Phase 2：mock 生成）
 * 后续阶段在此接：③ 校验 → ④ 故障注入 → ⑤ 状态 CRUD
 */
import {
  assembleResponse,
  operationSeed,
  requestFingerprint,
  fnv1a32,
} from '@datakit/core';
import type { ResponseSpec, RouteModel } from '@datakit/shared';
import { getProject, matchRoute, nearestRoutes } from './registry';

const MOUNT_RE = /^\/p\/([^/]+)(\/.*)?$/;

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Elysia mount 用的 fetch handler */
export async function mockHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const m = MOUNT_RE.exec(url.pathname);
  if (!m) {
    return json(404, {
      error: 'not_found',
      message: `mock 流量应走 /p/{项目标识}/… 形式，收到 ${url.pathname}`,
    });
  }
  const slug = m[1]!;
  const rest = m[2] ?? '/';

  const project = getProject(slug);
  if (!project) {
    return json(404, {
      error: 'not_found',
      message: `项目 "${slug}" 不存在或尚未导入 spec`,
    });
  }

  // HEAD 按 HTTP 语义回退到 GET
  const hit =
    matchRoute(slug, request.method, rest) ??
    (request.method === 'HEAD' ? matchRoute(slug, 'GET', rest) : null);
  if (!hit) {
    const hints = nearestRoutes(slug, request.method, rest);
    return json(404, {
      error: 'route_not_found',
      message: `无匹配路由 ${request.method.toUpperCase()} ${rest}`,
      ...(hints.length > 0 ? { nearest: hints } : {}),
    });
  }

  const { route } = hit;

  // SSE 需要长连接处理（Phase 5），先占位
  if (route.streaming === 'sse') {
    return json(501, {
      error: 'streaming_pending',
      message: 'SSE 流式响应将在 Phase 5 启用',
    });
  }

  // 请求指纹（含 body —— 不同输入 → 不同生成结果）
  let bodyText = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      bodyText = await request.text();
    } catch {
      bodyText = '';
    }
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const fingerprint =
    requestFingerprint(request.method, rest, query) +
    (bodyText ? ` ${fnv1a32(bodyText).toString(16)}` : '');

  const opSeed = operationSeed({
    projectSalt: project.seedSalt,
    operationKey: `${route.method} ${route.path}`,
    fingerprint,
    scenario: 'default',
  });

  // 成功响应定义
  const response = pickResponse(route);

  // 下载流式：Phase 2 先给文本体，Phase 5 做真流式
  if (route.streaming === 'download') {
    const content = assembleResponse(response?.schema, {
      opSeed,
      locale: 'zh_CN',
      ...(response?.example !== undefined ? { example: response.example } : {}),
    });
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    return new Response(text, {
      status: response?.status ?? 200,
      headers: {
        'content-type': response?.contentType ?? 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="mock-${fnv1a32(rest).toString(16)}.txt"`,
        'x-mock-seed': String(opSeed),
      },
    });
  }

  // 普通 JSON 响应
  const value = assembleResponse(response?.schema, {
    opSeed,
    locale: 'zh_CN',
    ...(response?.example !== undefined ? { example: response.example } : {}),
  });

  const res = json(response?.status ?? 200, value, { 'x-mock-seed': String(opSeed) });
  // HEAD 无响应体（HTTP 语义）
  if (request.method === 'HEAD') {
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return res;
}

function pickResponse(route: RouteModel): ResponseSpec | undefined {
  return (
    route.responses.find((r) => r.status === route.successStatus) ??
    route.responses.find((r) => r.status >= 200 && r.status < 300) ??
    route.responses[0]
  );
}
