/**
 * 资源模型 / 流式语义推断 —— 从路径模板 + HTTP 方法猜测 CRUD 绑定。
 *
 * 推断是启发式的，结果全部落库、可在 UI 人工修正（FR-05.8）。
 * 无法推断的路由退化为 stateless 生成（kind: 'none'），不影响可用性。
 */
import type { CrudBinding, HttpMethod, StreamKind } from '@datakit/shared';

const PARAM_RE = /^\{[+]?([^}]+)\}$/;

function paramNames(template: string): string[] {
  return template
    .split('/')
    .filter(Boolean)
    .map((s) => PARAM_RE.exec(s)?.[1])
    .filter((n): n is string => !!n);
}

/**
 * CRUD 语义推断规则：
 * - `/{collection}` + GET/POST → list/create（仅当路径只有一段，或路径含参数）
 * - `/{collection}/{id}` + GET/PUT/PATCH/DELETE → get/update/update/delete
 * - 其余（两段以上纯静态 = 动作型路径，如 /report/generate）→ none
 */
export function inferCrud(
  path: string,
  method: HttpMethod,
  listResponseArrayPath?: string
): CrudBinding {
  const segments = path.split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';
  const lastParam = PARAM_RE.exec(last);
  const hasParam = paramNames(path).length > 0;

  const base: CrudBinding = { kind: 'none', idField: 'id' };

  // 末位是参数 → 单实体操作
  if (lastParam && segments.length >= 2) {
    const idParam = lastParam[1]!;
    // 资源类型取参数的前一段（`/users/{id}` → users）
    let resourceType = segments[segments.length - 2] ?? '';
    // 前一段本身也是参数（如 /{ver}/{id}）时放弃推断
    if (PARAM_RE.test(resourceType)) return base;

    // 通配参数（filepath 等）不视为实体主键
    if (idParam === 'path' || idParam === 'filepath' || idParam === 'wildcard') {
      return base;
    }

    switch (method) {
      case 'GET':
        return { kind: 'get', resourceType, idParam, idField: 'id' };
      case 'PUT':
      case 'PATCH':
        return { kind: 'update', resourceType, idParam, idField: 'id' };
      case 'DELETE':
        return { kind: 'delete', resourceType, idParam, idField: 'id' };
      default:
        return base;
    }
  }

  // 末位是静态段 → 集合操作
  // 判定为「集合」的条件（排除动作型 /report/generate）：
  // - 单段路径（/users）
  // - 路径含参数（/users/{id}/posts）
  // - 末段像复数资源名（/api/users、/v1/orders）
  const pluralLike = /^[a-z][a-z0-9_-]*s$/i.test(last) && !/ss$/i.test(last);
  const clearCollection = segments.length === 1 || hasParam || pluralLike;
  if (!clearCollection) return base;

  const resourceType = last;
  // 资源类型本身像参数/动作动词 → 不推断
  if (PARAM_RE.test(resourceType)) return base;

  switch (method) {
    case 'GET':
      return {
        kind: 'list',
        resourceType,
        listEnvelope: listResponseArrayPath ?? '',
        idField: 'id',
      };
    case 'POST':
      return { kind: 'create', resourceType, idField: 'id' };
    default:
      return base;
  }
}

/**
 * 流式语义检测：
 * - 请求体 multipart / octet-stream → upload
 * - 响应 text/event-stream → sse
 * - 响应 application/octet-stream 或 schema format: binary → download
 */
export function inferStreaming(input: {
  requestBodyContentTypes: string[];
  requestBodySchemas: unknown[];
  responseContentTypes: string[];
  responseSchemas: unknown[];
}): StreamKind | undefined {
  const reqTypes = input.requestBodyContentTypes.map((t) => t.toLowerCase());
  const resTypes = input.responseContentTypes.map((t) => t.toLowerCase());

  if (resTypes.some((t) => t.includes('text/event-stream'))) return 'sse';
  if (
    resTypes.some((t) => t.includes('application/octet-stream')) ||
    input.responseSchemas.some(hasBinaryFormat)
  ) {
    return 'download';
  }
  if (
    reqTypes.some(
      (t) => t.includes('multipart/form-data') || t.includes('application/octet-stream')
    ) ||
    input.requestBodySchemas.some(hasBinaryFormat)
  ) {
    return 'upload';
  }
  return undefined;
}

function hasBinaryFormat(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s['format'] === 'binary' || s['format'] === 'byte') return true;
  // 浅层递归（properties / items）
  for (const key of ['properties', 'items'] as const) {
    const child = s[key];
    if (child && typeof child === 'object') {
      if (key === 'properties') {
        for (const v of Object.values(child as Record<string, unknown>)) {
          if (hasBinaryFormat(v)) return true;
        }
      } else if (hasBinaryFormat(child)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 列表信封检测：找出响应 schema 里数组字段的 JSON 路径。
 * - 顶层即数组 → ''
 * - object 里包一层（data.items / rows / list / records / content…）→ 'data.items'
 * - 找不到 → undefined（不做列表查询下推）
 */
const LIST_KEYS = ['items', 'list', 'rows', 'records', 'data', 'result', 'content', 'data'];

export function detectListEnvelope(schema: unknown, depth = 0): string | undefined {
  if (!schema || typeof schema !== 'object' || depth > 2) return undefined;
  const s = schema as Record<string, unknown>;

  if (s['type'] === 'array') return '';

  const props = s['properties'];
  if (props && typeof props === 'object') {
    const entries = Object.entries(props as Record<string, unknown>);
    // 优先按常见信封 key 排序
    const ordered = entries.sort((a, b) => {
      const ai = LIST_KEYS.indexOf(a[0]);
      const bi = LIST_KEYS.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    for (const [key, child] of ordered) {
      if (child && typeof child === 'object') {
        const c = child as Record<string, unknown>;
        if (c['type'] === 'array') return key;
        const nested = detectListEnvelope(child, depth + 1);
        if (nested !== undefined) return `${key}.${nested}`;
      }
    }
  }
  return undefined;
}
