/**
 * Mock 生成引擎 —— schema → 数据，字段级确定性。
 *
 * 生成优先级（节点内）：
 *   字段覆盖 > const/enum > 字段名启发式 > format 生成 > schema 生成
 * （更高层的 bodyStatic/bodyPatch/spec example 优先级在响应装配里处理）
 *
 * 确定性（评审强化的字段级 seed）：
 *   seed(field) = hash(opSeed, JSON Path)
 *   → schema 增删字段时兄弟字段数据不漂移；可选属性「是否出现」同样确定
 */
import { fakerZH_CN, fakerEN, type Faker } from '@faker-js/faker';
import { generateSync } from 'json-schema-faker';
import type { FieldGenerator, FieldOverride, JsonSchema } from '@datakit/shared';
import { fieldSeed, mulberry32, optionalPresent } from '../seed';
import { heuristicValue, zhWordsSentence, type FakerLike } from './heuristics';

type Schema = Record<string, unknown>;

export interface MockValueOptions {
  /** 操作级 seed（operationSeed 的输出） */
  opSeed: number;
  locale?: 'zh_CN' | 'en';
  fieldOverrides?: FieldOverride[];
  /** 数组默认条数区间 */
  arrayMin?: number;
  arrayMax?: number;
}

interface Ctx {
  opSeed: number;
  faker: Faker & FakerLike;
  overrides: FieldOverride[];
  arrayMin: number;
  arrayMax: number;
  /** increment 生成器的共享序列（每次生成重置，调用内确定） */
  incrementSeq: number;
}

const MAX_DEPTH = 32;

export function generateFromSchema(schema: unknown, options: MockValueOptions): unknown {
  const ctx: Ctx = {
    opSeed: options.opSeed >>> 0,
    faker: (options.locale === 'en' ? fakerEN : fakerZH_CN) as Faker & FakerLike,
    overrides: options.fieldOverrides ?? [],
    arrayMin: options.arrayMin ?? 1,
    arrayMax: options.arrayMax ?? 3,
    incrementSeq: 0,
  };
  return generateNode(schema, '', ctx, 0);
}

// ============ 节点分派 ============

function generateNode(schema: unknown, path: string, ctx: Ctx, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (!schema || typeof schema !== 'object') return null;

  const s = resolveComposition(schema as Schema, path, ctx);

  // 字段覆盖（同 path 精确命中）
  const override = ctx.overrides.find((o) => o.path === path);
  if (override) return applyGenerator(override.generator, path, ctx);

  // const / enum 确定性取值
  if ('const' in s) return s['const'];
  const enumVals = s['enum'];
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    return enumVals[fieldSeed(ctx.opSeed, path) % enumVals.length];
  }

  const type = effectiveType(s);
  if (type === 'object' || s['properties']) return generateObject(s, path, ctx, depth);
  if (type === 'array' || s['items']) return generateArray(s, path, ctx, depth);
  return generateLeaf(s, path, type, ctx);
}

/** allOf 合并；oneOf/anyOf 按 seed 选支（确定性） */
function resolveComposition(schema: Schema, path: string, ctx: Ctx): Schema {
  let s: Schema = { ...schema };

  if (Array.isArray(s['allOf'])) {
    const merged: Schema = { ...s };
    delete merged['allOf'];
    for (const branch of s['allOf'] as Schema[]) {
      const b = resolveComposition(branch, path, ctx);
      merged['properties'] = {
        ...((merged['properties'] as Schema) ?? {}),
        ...((b['properties'] as Schema) ?? {}),
      };
      merged['required'] = [
        ...new Set([
          ...((merged['required'] as string[]) ?? []),
          ...((b['required'] as string[]) ?? []),
        ]),
      ];
      if (b['type'] && !merged['type']) merged['type'] = b['type'];
    }
    s = merged;
  }

  const branchKey = s['oneOf'] ? 'oneOf' : s['anyOf'] ? 'anyOf' : null;
  if (branchKey && Array.isArray(s[branchKey])) {
    const branches = s[branchKey] as Schema[];
    const picked = branches[fieldSeed(ctx.opSeed, `${path}#${branchKey}`) % branches.length] ?? {};
    const merged: Schema = { ...s };
    delete merged[branchKey];
    const p = resolveComposition(picked, path, ctx);
    s = {
      ...p,
      ...merged,
      properties: { ...((p['properties'] as Schema) ?? {}), ...((merged['properties'] as Schema) ?? {}) },
      required: [
        ...new Set([
          ...((p['required'] as string[]) ?? []),
          ...((merged['required'] as string[]) ?? []),
        ]),
      ],
    };
  }

  return s;
}

function effectiveType(s: Schema): string {
  const t = s['type'];
  if (Array.isArray(t)) return (t.find((x) => x !== 'null') as string) ?? 'string';
  if (typeof t === 'string') return t;
  return 'string';
}

// ============ 对象 / 数组 ============

function generateObject(s: Schema, path: string, ctx: Ctx, depth: number): unknown {
  const props = (s['properties'] as Record<string, Schema>) ?? {};
  const required = new Set((s['required'] as string[]) ?? []);
  const out: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const childPath = path ? `${path}.${key}` : key;

    // 可选属性是否出现 —— 也由 seed 决定（稳定）
    // 但被字段覆盖（或其子树被覆盖）的字段强制出现
    const hasOverride = ctx.overrides.some(
      (o) => o.path === childPath || o.path.startsWith(`${childPath}.`) || o.path.startsWith(`${childPath}[`)
    );
    if (!hasOverride && !required.has(key) && required.size > 0) {
      if (!optionalPresent(fieldSeed(ctx.opSeed, childPath), childPath, 0.7)) continue;
    }

    out[key] = generateNode(propSchema, childPath, ctx, depth + 1);
  }

  return out;
}

function generateArray(s: Schema, path: string, ctx: Ctx, depth: number): unknown {
  const min = typeof s['minItems'] === 'number' ? (s['minItems'] as number) : ctx.arrayMin;
  const max = typeof s['maxItems'] === 'number' ? (s['maxItems'] as number) : Math.max(min, ctx.arrayMax);
  const count = min + (fieldSeed(ctx.opSeed, `${path}#len`) % (max - min + 1));

  const items: unknown[] = [];
  for (let i = 0; i < count; i++) {
    items.push(generateNode(s['items'] ?? {}, `${path}[${i}]`, ctx, depth + 1));
  }
  return items;
}

/** 确定性日期：与真实时钟无关（否则字节级复现会被毫秒破坏） */
function seededDate(seed: number): Date {
  const BASE = Date.UTC(2025, 0, 1);
  const DAY = 86_400_000;
  return new Date(BASE + (seed % 400) * DAY + (seed % DAY));
}

/** 包一层：把 date.recent 换成 seed 确定性版本 */
function withDeterministicDates(faker: Faker & FakerLike, seed: number): Faker & FakerLike {
  const dateMod = {
    ...faker.date,
    recent: () => seededDate(seed),
    past: () => seededDate(seed),
    future: () => seededDate(seed + 1000),
    anytime: () => seededDate(seed),
  };
  return new Proxy(faker, {
    get(target, prop, receiver) {
      if (prop === 'date') return dateMod;
      return Reflect.get(target, prop, receiver);
    },
  }) as Faker & FakerLike;
}

// ============ 叶子 ============

function generateLeaf(s: Schema, path: string, type: string, ctx: Ctx): unknown {
  const fieldName = fieldNameOf(path);
  const seed = fieldSeed(ctx.opSeed, path);
  const f = withDeterministicDates(ctx.faker, seed);
  f.seed(seed);

  // 0. pattern 约束优先于启发式 —— 生成值必须满足契约
  //    （如 phone 的 ^1[3-9][0-9]{9}$，启发式随机手机号无法保证）
  const hasPattern = s['pattern'] !== undefined;

  // 1. 字段名启发式（只吃 type 兼容的；有 pattern 时跳过）
  if (!hasPattern) {
    const heuristic = heuristicValue(f, fieldName, type);
    if (heuristic !== undefined) return heuristic;
  }

  // 2. format 生成（pattern 会与 format 冲突时也以 pattern 为准 → 走 JSF）
  const format = s['format'];
  if (type === 'string' && typeof format === 'string' && !hasPattern) {
    switch (format) {
      case 'uuid':
        return f.string.uuid();
      case 'email':
        return f.internet.email();
      case 'date-time':
        return seededDate(seed).toISOString();
      case 'date':
        return seededDate(seed).toISOString().slice(0, 10);
      case 'time':
        return seededDate(seed).toISOString().slice(11, 19);
      case 'uri':
      case 'url':
        return f.internet.url();
      case 'hostname':
        return f.internet.domainName();
      case 'ipv4':
        return f.internet.ipv4();
      case 'byte':
      case 'binary':
        return f.string.alphanumeric(32);
      default:
        break;
    }
  }

  // 3. 类型回落
  switch (type) {
    case 'boolean':
      return ctx.faker.datatype.boolean();
    case 'integer': {
      const min = typeof s['minimum'] === 'number' ? (s['minimum'] as number) : 0;
      const max = typeof s['maximum'] === 'number' ? (s['maximum'] as number) : min + 10000;
      return Math.round(
        mulberry32(seed)() * (max - min) + min
      );
    }
    case 'number': {
      const min = typeof s['minimum'] === 'number' ? (s['minimum'] as number) : 0;
      const max = typeof s['maximum'] === 'number' ? (s['maximum'] as number) : min + 100;
      return Math.round((mulberry32(seed)() * (max - min) + min) * 100) / 100;
    }
    case 'null':
      return null;
    case 'string':
    default: {
      // 有约束（pattern/长度）→ 交给 JSF 遵守约束；无约束 → 中文词组，观感更真实
      const hasConstraint =
        s['pattern'] !== undefined ||
        s['minLength'] !== undefined ||
        s['maxLength'] !== undefined;
      if (hasConstraint) {
        try {
          return generateSync({ ...s, type: 'string' } as JsonSchema, {
            seed,
            optionalsProbability: 1,
          });
        } catch {
          return zhWordsSentence(ctx.faker, 4);
        }
      }
      return zhWordsSentence(ctx.faker, 3);
    }
  }
}

// ============ 字段覆盖生成器 ============

function applyGenerator(gen: FieldGenerator, path: string, ctx: Ctx): unknown {
  switch (gen.kind) {
    case 'literal':
      return gen.value;
    case 'faker': {
      const seed = fieldSeed(ctx.opSeed, path);
      ctx.faker.seed(seed);
      return callFaker(ctx.faker, gen.method, gen.args ?? []);
    }
    case 'template':
      return gen.template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, expr: string) => {
        ctx.faker.seed(fieldSeed(ctx.opSeed, `${path}#${expr}`));
        const v = callFaker(ctx.faker, expr.trim(), []);
        return String(v);
      });
    case 'increment': {
      const start = gen.start ?? 1;
      const step = gen.step ?? 1;
      const value = start + ctx.incrementSeq * step;
      ctx.incrementSeq += 1;
      return value;
    }
    case 'now': {
      const iso = new Date().toISOString();
      if (gen.format === 'timestamp') return Date.parse(iso);
      if (gen.format === 'date') return iso.slice(0, 10);
      return iso;
    }
  }
}

/** 调 faker 的点路径方法，如 person.fullName */
function callFaker(faker: Faker & FakerLike, methodPath: string, args: unknown[]): unknown {
  const parts = methodPath.split('.');
  let obj: unknown = faker;
  for (const p of parts.slice(0, -1)) {
    obj = (obj as Record<string, unknown>)?.[p];
    if (obj == null) return zhWordsSentence(faker, 3);
  }
  const fn = (obj as Record<string, unknown>)[parts[parts.length - 1]!];
  if (typeof fn === 'function') {
    return (fn as (...a: unknown[]) => unknown).apply(obj, args);
  }
  return zhWordsSentence(faker, 3);
}

/** 从 JSON Path 取字段名：user.profile.name → name；items[0].price → price */
export function fieldNameOf(path: string): string {
  if (!path) return '';
  const cleaned = path.replace(/\[\d+\]/g, '');
  const segs = cleaned.split('.');
  return segs[segs.length - 1] ?? '';
}
