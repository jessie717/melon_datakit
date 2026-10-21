/**
 * Mock Dispatcher —— 接收 /p/:slug/** 的全部 mock 流量。
 *
 * 管线：路径匹配 → 规则加载 → ③ 校验 → ④ 故障/延迟注入
 *      → 流式（上传/下载/SSE）| ⑤ 状态 CRUD | ⑥ 无状态生成
 */
import {
  assembleResponse,
  fnv1a32,
  operationSeed,
  requestFingerprint,
  validateRequest,
} from '@datakit/core';
import type {
  MockRule,
  ProjectConfig,
  ResponseSpec,
  RouteModel,
  ValidationMode,
} from '@datakit/shared';
import { getProject, matchRoute, nearestRoutes } from './registry';
import { getRule } from './rules';
import { handleStateful } from './stateful';
import { handleDownload, handleSse, handleUpload } from './stream';

type BunServerRef = { timeout(req: Request, seconds: number): void } | null | undefined;

const MOUNT_RE = /^\/p\/([^/]+)(\/.*)?$/;

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Elysia mount 用的 fetch handler */
export async function mockHandler(request: Request, server?: BunServerRef): Promise<Response> {
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
  const config = project.config;
  const rule = getRule(project.projectId, route.method, route.path);

  // 请求体（流式上传不在这里读 —— 处理器直接消费 body 流）
  let bodyText = '';
  const isUpload = route.streaming === 'upload';
  if (!isUpload && request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      bodyText = await request.text();
    } catch {
      bodyText = '';
    }
  }
  let parsedBody: unknown;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = bodyText;
    }
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const headers = Object.fromEntries(request.headers.entries());

  // —— ③ 请求校验（multipart 上传不做 body 校验）——
  const mode: ValidationMode = rule?.validationMode ?? config.validationMode;
  const validation = validateRequest(
    {
      route,
      params: hit.params,
      query,
      headers,
      ...(parsedBody !== undefined && !isUpload ? { body: parsedBody } : {}),
    },
    mode
  );
  if (validation.shouldReject) {
    return buildValidationErrorResponse(route, validation.issues);
  }

  // —— ④ 故障 / 延迟注入 ——
  const latencyMs = rule?.latencyMs ?? config.defaultLatencyMs;
  if (latencyMs > 0) await sleep(latencyMs);

  if (rule?.enabled !== false) {
    // 错误率（规则覆盖项目默认）—— 概率性，故意引入非确定性
    const rate = rule?.errorRate ?? config.defaultErrorRate;
    if (rate > 0 && Math.random() < rate) {
      const status = rule?.errorStatus ?? 500;
      return json(
        status,
        rule?.errorBody ?? {
          error: 'mock_error',
          message: `按规则注入的错误（errorRate=${rate}）`,
        },
        { 'x-mock-seed': 'error', 'x-mock-fault': 'error-rate' }
      );
    }
  }

  const fingerprint =
    requestFingerprint(request.method, rest, query) +
    (bodyText ? ` ${fnv1a32(bodyText).toString(16)}` : '');

  const opSeed = rule?.seed ?? operationSeed({
    projectSalt: config.seedSalt,
    operationKey: `${route.method} ${route.path}`,
    fingerprint,
    scenario: 'default',
  });

  // bodyStatic 优先级最高（覆盖一切）
  if (rule?.bodyStatic !== undefined) {
    return json(rule.statusOverride ?? route.successStatus ?? 200, rule.bodyStatic, {
      'x-mock-seed': String(opSeed),
      'x-mock-rule': 'bodyStatic',
    });
  }

  // —— 流式处理（上传/下载/SSE）——
  if (route.streaming) {
    const ctx = { request, route, config, ...(rule ? { rule } : {}), opSeed, server };
    switch (route.streaming) {
      case 'upload':
        return handleUpload(ctx);
      case 'download':
        return handleDownload(ctx);
      case 'sse':
        return handleSse(ctx);
    }
  }

  // —— ⑤ 状态化 CRUD（REST 语义路由落库）——
  const stateful = await handleStateful({
    route,
    projectId: project.projectId,
    config,
    ...(rule ? { rule } : {}),
    params: hit.params,
    query,
    ...(parsedBody !== undefined ? { body: parsedBody } : {}),
    opSeed,
  });
  if (stateful) {
    if (request.method === 'HEAD') {
      return new Response(null, { status: stateful.status, headers: stateful.headers });
    }
    return stateful;
  }

  // —— ⑥ 无状态生成 ——
  const forcedStatus = rule?.statusOverride;
  const response =
    (forcedStatus !== undefined && forcedStatus !== null
      ? route.responses.find((r) => r.status === forcedStatus)
      : undefined) ?? pickResponse(route);

  const value = assembleResponse(response?.schema, {
    opSeed,
    locale: config.locale,
    ...(response?.example !== undefined ? { example: response.example } : {}),
    ...(rule?.bodyPatch !== undefined ? { bodyPatch: rule.bodyPatch } : {}),
    ...(rule?.fieldOverrides?.length ? { fieldOverrides: rule.fieldOverrides } : {}),
  });

  const res = json(forcedStatus ?? response?.status ?? 200, value, {
    'x-mock-seed': String(opSeed),
    ...(validation.issues.length > 0 ? { 'x-mock-validation': 'warned' } : {}),
  });
  // HEAD 无响应体（HTTP 语义）
  if (request.method === 'HEAD') {
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return res;
}

// ============ 校验错误响应 ============

function buildValidationErrorResponse(
  route: RouteModel,
  issues: Array<{ in: string; name: string; keyword: string; message: string }>
): Response {
  // spec 自己定义了 400/422 → 优先套用 spec 的形状（example 优先）
  const specError =
    route.responses.find((r) => r.status === 422) ??
    route.responses.find((r) => r.status === 400);

  const details = issues.map((i) => ({
    in: i.in,
    name: i.name,
    keyword: i.keyword,
    message: i.message,
  }));

  const body =
    specError && specError.example !== undefined && typeof specError.example === 'object'
      ? { ...(specError.example as Record<string, unknown>), details }
      : { error: 'validation_error', message: '请求参数不符合接口文档定义', details };

  return json(specError?.status ?? 400, body, { 'x-mock-validation': 'rejected' });
}

function pickResponse(route: RouteModel): ResponseSpec | undefined {
  return (
    route.responses.find((r) => r.status === route.successStatus) ??
    route.responses.find((r) => r.status >= 200 && r.status < 300) ??
    route.responses[0]
  );
}
