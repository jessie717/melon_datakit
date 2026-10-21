/**
 * 流式处理 —— 上传 / 下载 / SSE。
 *
 * 已规避的坑（调研证实）：
 * - Bun idleTimeout 默认 10s 且流式期间照计：SSE/长下载必须 server.timeout(req, 0)
 * - 裸 ReadableStream 直接 return 会 100% CPU（Elysia #1741）：统一 new Response(stream)
 * - 客户端断开不触发 cancel（#1768）：挂 request.signal abort → stream.cancel()
 */
import {
  assembleResponse,
  blocksToStream,
  downloadBlocks,
  extractBoundary,
  fieldSeed,
  fnv1a32,
  generateFromSchema,
  parseMultipartStream,
  parseRange,
} from '@datakit/core';
import type { MockRule, ProjectConfig, ResponseSpec, RouteModel } from '@datakit/shared';

export interface StreamContext {
  request: Request;
  route: RouteModel;
  config: ProjectConfig;
  rule?: MockRule;
  opSeed: number;
  /** Bun server 引用（设置 timeout 用） */
  server?: { timeout(req: Request, seconds: number): void } | null;
}

function pickResponse(route: RouteModel): ResponseSpec | undefined {
  return (
    route.responses.find((r) => r.status === route.successStatus) ??
    route.responses.find((r) => r.status >= 200 && r.status < 300) ??
    route.responses[0]
  );
}

/** 长连接请求关闭空闲超时 */
function disableIdleTimeout(ctx: StreamContext): void {
  try {
    ctx.server?.timeout(ctx.request, 0);
  } catch {
    // server 引用不可用时忽略（测试环境）
  }
}

/** 客户端断开 → 取消流 */
function bindAbort(request: Request, stream: ReadableStream<Uint8Array>): void {
  request.signal?.addEventListener('abort', () => {
    void stream.cancel('client aborted').catch(() => {});
  });
}

// ============ 上传 ============

export async function handleUpload(ctx: StreamContext): Promise<Response> {
  const { request, route, config, rule, opSeed } = ctx;
  const contentType = request.headers.get('content-type') ?? '';
  const response = pickResponse(route);

  const assembleOpts = {
    opSeed,
    locale: config.locale,
    ...(response?.example !== undefined ? { example: response.example } : {}),
    ...(rule?.fieldOverrides?.length ? { fieldOverrides: rule.fieldOverrides } : {}),
  };

  let files: Array<{ field: string; filename: string; contentType: string; size: number; sha256: string }> = [];
  let fields: Record<string, string> = {};
  let totalBytes = 0;

  if (contentType.includes('multipart/form-data')) {
    const boundary = extractBoundary(contentType);
    if (!boundary || !request.body) {
      return new Response(
        JSON.stringify({ error: 'bad_multipart', message: 'multipart 请求缺少 boundary 或 body' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
    const parsed = await parseMultipartStream(request.body, boundary);
    files = parsed.files;
    fields = parsed.fields;
    totalBytes = parsed.totalBytes;
  } else if (request.body) {
    // octet-stream / 其他：流式计数 + 哈希，不驻留
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of request.body) {
      hash.update(chunk);
      size += chunk.length;
    }
    totalBytes = size;
    files = [
      {
        field: 'file',
        filename: request.headers.get('x-filename') ?? 'upload.bin',
        contentType: contentType || 'application/octet-stream',
        size,
        sha256: hash.digest('hex'),
      },
    ];
  }

  // 响应：schema 生成为底，叠加真实上传信息（用户要看到真实结果）
  const generated = (assembleResponse(response?.schema, assembleOpts) ?? {}) as Record<string, unknown>;
  const uploadInfo = {
    filename: files[0]?.filename ?? null,
    size: files.reduce((a, f) => a + f.size, 0) || totalBytes,
    sha256: files[0]?.sha256 ?? null,
    files,
    fields,
  };
  const body =
    generated && typeof generated === 'object' && !Array.isArray(generated)
      ? { ...generated, ...uploadInfo }
      : uploadInfo;

  return new Response(JSON.stringify(body), {
    status: route.successStatus || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-mock-seed': String(opSeed),
      'x-mock-stream': 'upload',
    },
  });
}

// ============ 下载 ============

export const DEFAULT_DOWNLOAD_SIZE = 1024 * 1024; // 1MB
export const MAX_DOWNLOAD_SIZE = 512 * 1024 * 1024; // 512MB 上限

export function handleDownload(ctx: StreamContext): Response {
  const { request, route, config, rule, opSeed } = ctx;
  disableIdleTimeout(ctx);

  const url = new URL(request.url);
  const totalSize = Math.min(
    MAX_DOWNLOAD_SIZE,
    Math.max(1, Number(url.searchParams.get('size')) || DEFAULT_DOWNLOAD_SIZE)
  );

  const range = parseRange(request.headers.get('range'), totalSize);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${totalSize}` },
    });
  }
  const effective = range ?? { start: 0, end: totalSize - 1 };
  const length = effective.end - effective.start + 1;

  // 确定性内容流（块级生成，常量内存）
  const stream = blocksToStream(downloadBlocks(opSeed, effective, totalSize));
  bindAbort(request, stream);

  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'content-length': String(length),
    'content-disposition': `attachment; filename="mock-${fnv1a32(url.pathname).toString(16)}.bin"`,
    'accept-ranges': 'bytes',
    'x-mock-seed': String(opSeed),
    'x-mock-stream': 'download',
  };
  if (range) {
    headers['content-range'] = `bytes ${effective.start}-${effective.end}/${totalSize}`;
  }

  return new Response(range ? new Response(stream).body : stream, {
    status: range ? 206 : 200,
    headers,
  });
}

// ============ SSE ============

export const DEFAULT_SSE_INTERVAL_MS = 1000;

export function handleSse(ctx: StreamContext): Response {
  const { request, route, config, rule, opSeed } = ctx;
  disableIdleTimeout(ctx);

  const url = new URL(request.url);
  // ?count=N 发完 N 条后收尾（测试友好）；不传 = 长连接直到客户端断开
  const countParam = url.searchParams.get('count');
  const maxEvents = countParam ? Math.max(0, Number(countParam) || 0) : Infinity;
  const interval = Math.max(50, Number(url.searchParams.get('interval')) || DEFAULT_SSE_INTERVAL_MS);

  const response = pickResponse(route);
  // 事件 payload 的 schema：取响应 schema（若为 string 则生成普通文本）
  const eventSchema = response?.schema;

  const encoder = new TextEncoder();
  let eventIndex = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => {
        if (closed) return;
        if (eventIndex >= maxEvents) {
          closed = true;
          if (timer) clearTimeout(timer);
          controller.close();
          return;
        }
        const eventSeed = fieldSeed(opSeed, `event#${eventIndex}`);
        const payload =
          rule?.bodyStatic ??
          generateFromSchema(eventSchema, {
            opSeed: eventSeed,
            locale: config.locale,
            ...(rule?.fieldOverrides?.length ? { fieldOverrides: rule.fieldOverrides } : {}),
          }) ??
          { index: eventIndex };

        const frame =
          `id: ${eventIndex}\n` +
          `event: mock\n` +
          `data: ${JSON.stringify(payload)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
          return;
        }
        eventIndex += 1;
        if (!closed) timer = setTimeout(push, interval);
      };

      // 立即推送首条（前端不用等一个周期）
      push();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  bindAbort(request, stream);

  return new Response(stream, {
    status: route.successStatus === 204 ? 200 : route.successStatus || 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-mock-seed': String(opSeed),
      'x-mock-stream': 'sse',
    },
  });
}
