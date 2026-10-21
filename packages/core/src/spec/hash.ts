/**
 * Schema 指纹 —— 用于变更检测（schemaHash）。
 *
 * 与 seed.ts 的 stableStringify 区别：这里要处理 dereference 后可能出现的
 * 循环引用（$ref 环），序列化时以 [Circular] 标记，不会栈溢出。
 */
import { fnv1a32 } from '../seed';

/** key 排序 + 循环安全的序列化 */
export function cycleSafeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const obj = v as object;
      if (seen.has(obj)) return '[Circular]';
      seen.add(obj);
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) {
        out[key] = walk(src[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * 64 位感觉的 schema 指纹：两遍 FNV-1a（正序 + 逆序）拼接。
 * 够用于变更检测，跨平台稳定。
 */
export function schemaHash(schema: unknown): string {
  const s = cycleSafeStringify(schema);
  const reversed = [...s].reverse().join('');
  const a = fnv1a32(s).toString(16).padStart(8, '0');
  const b = fnv1a32(reversed).toString(16).padStart(8, '0');
  return `${a}${b}`;
}
