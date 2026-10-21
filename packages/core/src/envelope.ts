/**
 * 列表信封与分页 —— 状态化 CRUD 的纯逻辑部分。
 *
 * 信封：listEnvelope = 'data.items' 这类 JSON 路径（'' = 响应本身就是数组）。
 * 分页：识别常见 query 参数（limit/size/pageSize/offset/page）。
 */
import type { JsonSchema } from '@datakit/shared';
import { getByPath, setByPath, tokenize } from './json-path';

export interface Pagination {
  limit?: number;
  offset: number;
  /** 原始 query 里被认作分页的键（过滤时排除） */
  pageKeys: string[];
}

const LIMIT_KEYS = ['limit', 'size', 'pageSize', 'page_size', 'per_page', 'perPage'] as const;
const OFFSET_KEYS = ['offset', 'skip'] as const;
const PAGE_KEYS = ['page', 'pageNo', 'page_no'] as const;

export function parsePagination(query: Record<string, string>): Pagination {
  const pageKeys: string[] = [];
  let limit: number | undefined;
  let offset = 0;
  let page: number | undefined;

  for (const [k, v] of Object.entries(query)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if ((LIMIT_KEYS as readonly string[]).includes(k)) {
      limit = Math.max(0, Math.floor(n));
      pageKeys.push(k);
    } else if ((OFFSET_KEYS as readonly string[]).includes(k)) {
      offset = Math.max(0, Math.floor(n));
      pageKeys.push(k);
    } else if ((PAGE_KEYS as readonly string[]).includes(k)) {
      page = Math.max(1, Math.floor(n));
      pageKeys.push(k);
    }
  }

  if (page !== undefined && limit !== undefined) offset = (page - 1) * limit;

  return { limit, offset, pageKeys };
}

/** 从列表响应 schema 取元素 schema（信封路径处的 items） */
export function itemSchemaOf(schema: JsonSchema | undefined, envelope: string): JsonSchema | undefined {
  if (!schema) return undefined;
  // 沿 schema 的 properties 逐段下钻（信封是数据路径，对应 schema 的属性链）
  let node: unknown = schema;
  if (envelope) {
    for (const seg of tokenize(envelope)) {
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)['properties'] ?? undefined;
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[seg];
    }
  }
  if (node && typeof node === 'object') {
    const n = node as Record<string, unknown>;
    if (n['type'] === 'array' || n['items']) {
      return (n['items'] as JsonSchema) ?? undefined;
    }
  }
  return undefined;
}

/**
 * 组装列表响应：
 * - envelope === '' → 直接返回实体数组
 * - 否则把 items 放进信封，并同步常见的计数字段（total/count/totalElements…）
 * - totalCount = 过滤后的总数（分页场景下 ≠ items.length）
 */
export function buildListResponse(
  base: unknown,
  envelope: string,
  items: unknown[],
  totalCount: number = items.length
): unknown {
  if (!envelope) return items;

  let out = setByPath(base, envelope, items);

  // 同步数组所在对象上的计数字段
  const tokens = tokenize(envelope);
  const last = tokens[tokens.length - 1]!;
  const parentPath = tokens.slice(0, -1).join('.');
  const parent = parentPath ? getByPath(out, parentPath) : out;
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
    const patch: Record<string, unknown> = {};
    for (const key of ['total', 'totalCount', 'totalElements', 'count', 'totalRows', 'records']) {
      if (key !== last && key in (parent as Record<string, unknown>)) {
        patch[key] = totalCount;
      }
    }
    if (Object.keys(patch).length > 0) {
      const merged = { ...(parent as Record<string, unknown>), ...patch };
      out = parentPath ? setByPath(out, parentPath, merged) : merged;
    }
  }

  return out;
}

/** 简单等值过滤：query 里非分页键，且实体 data 有同名字段 → 按值过滤 */
export function filterEntities<T extends { data: Record<string, unknown> }>(
  entities: T[],
  query: Record<string, string>,
  pageKeys: string[]
): T[] {
  const filters = Object.entries(query).filter(([k]) => !pageKeys.includes(k));
  if (filters.length === 0) return entities;
  return entities.filter((e) =>
    filters.every(([k, v]) => {
      const val = e.data[k];
      return val !== undefined && String(val) === v;
    })
  );
}
