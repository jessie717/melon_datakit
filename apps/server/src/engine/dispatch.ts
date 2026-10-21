/**
 * Mock Dispatcher —— 接收 /p/:slug/** 的全部 mock 流量。
 *
 * 管线：路径匹配 → 规则加载 → ③ 校验 → ④ 故障/延迟注入 → ⑥ mock 生成
 * 后续阶段在此接：⑤ 状态 CRUD（Phase 4）
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

const MOUNT_RE = /^\/p\/([^/]+)(\/.*)?$/;

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const config = project.config;
  const rule = getRule(project.projectId, route.method, route.path);

  // SSE 需要长连接处理（Phase 5），先占位
  if (route.streaming === 'sse') {
    return json(501, {
      error: 'streaming_pending',
      message: 'SSE 流式响应将在 Phase 5 启用',
    });
  }

  // 请求体
  let bodyText = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
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

  // —— ③ 请求校验 ——
  const mode: ValidationMode = rule?.validationMode ?? config.validationMode;
  const validation = validateRequest(
    {
      route,
      params: hit.params,
      query,
      headers,
      ...(parsedBody !== undefined ? { body: parsedBody } : {}),
    },
    mode
  );
  if (validation.shouldReject) {
    return buildValidationErrorResponse(route, validation.issues, project.projectId, config);
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

  // —— 生成（规则可覆盖 seed / body / 字段）——
  const fingerprint =
    requestFingerprint(request.method, rest, query) +
    (bodyText ? ` ${fnv1a32(bodyText).toString(16)}` : '');

  const opSeed = rule?.seed ?? operationSeed({
    projectSalt: config.seedSalt,
    operationKey: `${route.method} ${route.path}`,
    fingerprint,
    scenario: 'default',
  });

  // bodyStatic 优先级最高（覆盖一切，含状态化路由）
  if (rule?.bodyStatic !== undefined) {
    return json(rule.statusOverride ?? route.successStatus ?? 200, rule.bodyStatic, {
      'x-mock-seed': String(opSeed),
      'x-mock-rule': 'bodyStatic',
    });
  }

  // —— ⑤ 状态化 CRUD（REST 语义路由落库；其余走无状态生成）——
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

  // 强制状态码（前端联调错误分支）
  const forcedStatus = rule?.statusOverride;
  const response =
    (forcedStatus !== undefined && forcedStatus !== null
      ? route.responses.find((r) => r.status === forcedStatus)
      : undefined) ?? pickResponse(route);

  const assembleOpts = {
    opSeed,
    locale: config.locale,
    ...(response?.example !== undefined ? { example: response.example } : {}),
    ...(rule?.bodyStatic !== undefined ? { bodyStatic: rule.bodyStatic } : {}),
    ...(rule?.bodyPatch !== undefined ? { bodyPatch: rule.bodyPatch } : {}),
    ...(rule?.fieldOverrides?.length ? { fieldOverrides: rule.fieldOverrides } : {}),
  };

  // 下载流式：Phase 3 仍是文本体，Phase 5 做真流式
  if (route.streaming === 'download') {
    const content = assembleResponse(response?.schema, assembleOpts);
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    return new Response(text, {
      status: forcedStatus ?? response?.status ?? 200,
      headers: {
        'content-type': response?.contentType ?? 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="mock-${fnv1a32(rest).toString(16)}.txt"`,
        'x-mock-seed': String(opSeed),
      },
    });
  }

  const value = assembleResponse(response?.schema, assembleOpts);
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
  issues: Array<{ in: string; name: string; keyword: string; message: string }>,
  _projectId: string,
  _config: ProjectConfig
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

  let body: unknown;
  if (specError && specError.example !== undefined && typeof specError.example === 'object') {
    // 以 spec 示例为底，把校验细节并进去（不覆盖示例已有字段）
    body = { ...(specError.example as Record<string, unknown>), details };
  } else if (specError?.schema && Object.keys(specError.schema).length > 0) {
    body = {
      error: 'validation_error',
      message: '请求参数不符合接口文档定义',
      details,
    };
  } else {
    body = {
      error: 'validation_error',
      message: '请求参数不符合接口文档定义',
      details,
    };
  }

  return json(specError?.status ?? 400, body, { 'x-mock-validation': 'rejected' });
}

function pickResponse(route: RouteModel): ResponseSpec | undefined {
  return (
    route.responses.find((r) => r.status === route.successStatus) ??
    route.responses.find((r) => r.status >= 200 && r.status < 300) ??
    route.responses[0]
  );
}
