/**
 * 确定性 seed —— 字段级，保证 mock 数据可复现。
 *
 * 设计要点（评审强化过）：
 * - `operationSeed` = hash(项目盐, operationKey, 归一化请求指纹, scenario, seedOverride)
 * - `fieldSeed` = hash(operationSeed, 字段 JSON Path)
 *   → schema 增删字段时兄弟字段数据不漂移（只影响变更字段自身）
 * - 可选属性「是否出现」也由 fieldSeed 决定，稳定
 *
 * 哈希用 FNV-1a 32 位：零依赖、跨平台稳定、够快。
 */

/** FNV-1a 32 位哈希 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619（32 位溢出模拟）
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 稳定序列化：对象 key 排序，保证同内容同指纹 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortValue(src[key]);
    }
    return out;
  }
  return value;
}

/** 归一化请求指纹：method + path + 排序后的 query */
export function requestFingerprint(
  method: string,
  path: string,
  query: Record<string, string | string[]>
): string {
  const q = stableStringify(query ?? {});
  return `${method.toUpperCase()} ${path} ${q}`;
}

export interface OperationSeedInput {
  projectSalt: string;
  /** method + 模板路径，如 GET /users/{id} */
  operationKey: string;
  /** 归一化请求指纹（含实际 query/body） */
  fingerprint: string;
  /** 场景标签，如 'default' | 'error-500' | 'empty' */
  scenario?: string;
  /** 规则里固定的 seed 覆盖 */
  seedOverride?: number | null;
}

/** 操作级 seed */
export function operationSeed(input: OperationSeedInput): number {
  if (input.seedOverride != null) {
    return input.seedOverride >>> 0;
  }
  const parts = [
    input.projectSalt,
    input.operationKey,
    input.fingerprint,
    input.scenario ?? 'default',
  ].join(' ');
  return fnv1a32(parts);
}

/** 字段级 seed：opSeed ⊕ 字段 JSON Path */
export function fieldSeed(opSeed: number, jsonPath: string): number {
  return fnv1a32(`${opSeed} ${jsonPath}`);
}

/**
 * 可选属性「是否出现」的确定性判定。
 * 返回 true 表示该字段出现在本次响应里。
 */
export function optionalPresent(
  fieldOpSeed: number,
  jsonPath: string,
  probability = 0.7
): boolean {
  const h = fieldSeed(fieldOpSeed, `${jsonPath} present`);
  // 映射到 [0, 1)
  const unit = h / 0x100000000;
  return unit < probability;
}

/** Mulberry32 PRNG —— 给 json-schema-faker 用的确定性随机源 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
