/**
 * OpenAPI 路径模板匹配器。
 *
 * 规则（对齐 OpenAPI 路径语义，表驱动可单测）：
 * - `/users/{id}` 抽取 `{id}` 参数
 * - 静态段优先于参数段：`/pets/mine` 胜过 `/pets/{petId}`
 * - 末位通配段 `{filepath}`（也接受 `{+path}`）吞掉剩余路径（含 `/`）
 * - 尾斜杠归一化：`/users/` ≡ `/users`
 * - URL 解码：`/a%20b` → `/a b`
 * - 同方法内冲突按具体度排序（静态段多者优先）
 */

export type PathSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard'; name: string };

export interface CompiledPath {
  /** 归一化后的模板原文 */
  template: string;
  segments: PathSegment[];
  /** 具体度分数：静态段权重 > 参数段 > 通配段 */
  score: number;
  hasWildcard: boolean;
}

export interface MatchResult {
  template: string;
  params: Record<string, string>;
}

const WILDCARD_NAMES = new Set(['path', 'filepath', 'wildcard']);

/** 解析 OpenAPI 路径模板为段列表 */
export function compilePath(template: string): CompiledPath {
  const normalized = normalizePath(template);
  const raw = normalized.split('/').filter((s) => s.length > 0);
  const segments: PathSegment[] = [];
  let score = 0;
  let hasWildcard = false;

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i]!;
    const isLast = i === raw.length - 1;
    const paramMatch = /^\{[+]?([^}]+)\}$/.exec(seg);
    if (paramMatch) {
      const name = paramMatch[1]!;
      // 末位 + 名字像 path/filepath，或 {+name} 显式通配 → wildcard
      if (isLast && (seg.startsWith('{+') || WILDCARD_NAMES.has(name))) {
        segments.push({ kind: 'wildcard', name });
        hasWildcard = true;
        score += 1;
      } else {
        segments.push({ kind: 'param', name });
        score += 10;
      }
    } else {
      segments.push({ kind: 'static', value: seg });
      score += 100;
    }
  }

  return { template: normalized, segments, score, hasWildcard };
}

/** 尾斜杠归一化；根路径归一为 / */
export function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  let p = path.startsWith('/') ? path : `/${path}`;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** 解码单个路径段（容错：非法编码原样返回） */
function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * 将请求路径匹配到已编译模板集合。
 * 候选按具体度降序尝试，静态段优先命中。
 */
export function matchPath(
  compiled: CompiledPath[],
  requestPath: string
): MatchResult | null {
  const normalized = normalizePath(requestPath);
  const parts = normalized.split('/').filter((s) => s.length > 0);
  const sorted = [...compiled].sort((a, b) => b.score - a.score);

  for (const cand of sorted) {
    const params: Record<string, string> = {};
    const segs = cand.segments;
    let ok = true;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      if (seg.kind === 'wildcard') {
        // 吞掉 i 开始到结尾的所有段（保留斜杠）
        params[seg.name] = parts.slice(i).map(safeDecode).join('/');
        // 通配必须是最后一段，直接判定
        ok = true;
        // 用标记提前结束
        (params as Record<string, string> & { __consumed?: number }).__consumed = parts.length;
        return finishMatch(cand.template, params, parts.length);
      }
      if (i >= parts.length) {
        ok = false;
        break;
      }
      const part = safeDecode(parts[i]!);
      if (seg.kind === 'static') {
        if (seg.value !== part) {
          ok = false;
          break;
        }
      } else {
        params[seg.name] = part;
      }
    }

    // 段数必须一致（无通配时）
    if (ok && !cand.hasWildcard && segs.length === parts.length) {
      return { template: cand.template, params };
    }
  }

  return null;
}

function finishMatch(
  template: string,
  params: Record<string, string>,
  _consumed: number
): MatchResult {
  // 去掉内部标记
  delete (params as Record<string, unknown>).__consumed;
  return { template, params };
}

/** 从模板集合中按 method+template 找到路由（供 dispatcher 取 RouteModel） */
export function buildMatcher(routes: Array<{ method: string; path: string }>) {
  const byMethod = new Map<string, CompiledPath[]>();
  for (const r of routes) {
    const key = r.method.toUpperCase();
    const list = byMethod.get(key) ?? [];
    list.push(compilePath(r.path));
    byMethod.set(key, list);
  }

  return {
    match(method: string, requestPath: string): MatchResult | null {
      const list = byMethod.get(method.toUpperCase());
      if (!list) return null;
      return matchPath(list, requestPath);
    },
  };
}
