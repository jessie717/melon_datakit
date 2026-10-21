/**
 * JSON 路径工具 —— 放在 core 供生成/装配/信封共用。
 * 形式：a.b.c 与 a[0].b（数组下标）。
 */

export function tokenize(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
}

export function getByPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of tokenize(path)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setByPath(value: unknown, path: string, v: unknown): unknown {
  return setTokens(value, tokenize(path), 0, v);
}

function setTokens(obj: unknown, tokens: string[], i: number, v: unknown): unknown {
  if (i >= tokens.length) return v;
  const key = tokens[i]!;
  if (Array.isArray(obj)) {
    const idx = Number(key);
    const copy = [...obj];
    copy[idx] = setTokens(copy[idx] ?? {}, tokens, i + 1, v);
    return copy;
  }
  const base = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
  return { ...base, [key]: setTokens(base[key] ?? {}, tokens, i + 1, v) };
}

/** 深合并（patch 优先），用于 bodyPatch / 请求体叠加 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object') {
    const b = (base && typeof base === 'object' ? base : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return patch;
}
