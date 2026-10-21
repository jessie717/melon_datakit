/**
 * 响应装配 —— 固定优先级链（定死，禁止另行发明）：
 *
 *   bodyStatic > bodyPatch > 字段覆盖 > spec example > schema 生成
 */
import type { FieldOverride, JsonSchema } from '@datakit/shared';
import { generateFromSchema, type MockValueOptions } from './generate';
import { deepMerge, setByPath } from '../json-path';

export interface AssembleOptions extends MockValueOptions {
  /** spec 的 example（已从响应定义抽出） */
  example?: unknown;
  /** 规则级整响应静态覆盖 */
  bodyStatic?: unknown;
  /** 规则级局部 patch */
  bodyPatch?: Record<string, unknown>;
}

export function assembleResponse(schema: JsonSchema | undefined, options: AssembleOptions): unknown {
  const { example, bodyStatic, bodyPatch, fieldOverrides = [], ...genOpts } = options;

  // 1. bodyStatic —— 最高优先级
  if (bodyStatic !== undefined) return bodyStatic;

  // 2~5. 基础值：字段覆盖存在时不能直接用 example（覆盖要生效在 example 之上）
  let base: unknown;
  const hasOverrides = fieldOverrides.length > 0;

  if (example !== undefined && !hasOverrides) {
    base = deepClone(example);
  } else if (example !== undefined) {
    // example + 覆盖：以 example 为底，覆盖改写指定路径
    base = applyFieldOverrides(deepClone(example), fieldOverrides, genOpts.opSeed);
  } else {
    base = generateFromSchema(schema, { ...genOpts, fieldOverrides });
  }

  // 2. bodyPatch —— 局部 patch
  if (bodyPatch && typeof bodyPatch === 'object') {
    base = deepMerge(base, bodyPatch);
  }

  return base;
}

// ============ 字段覆盖落盘（作用于 example 基底） ============

import { fieldSeed } from '../seed';
import type { FieldGenerator } from '@datakit/shared';
import { fakerZH_CN, fakerEN, type Faker } from '@faker-js/faker';
import type { FakerLike } from './heuristics';

function applyFieldOverrides(
  value: unknown,
  overrides: FieldOverride[],
  opSeed: number
): unknown {
  let out = value;
  for (const o of overrides) {
    out = setByPath(out, o.path, makeValue(o.generator, o.path, opSeed));
  }
  return out;
}

function makeValue(gen: FieldGenerator, path: string, opSeed: number): unknown {
  // 与 generate.ts 的 applyGenerator 同语义（literal/now 可直接算；
  // faker/template 需要 seed，这里保持一致）
  if (gen.kind === 'literal') return gen.value;
  if (gen.kind === 'now') {
    const iso = new Date().toISOString();
    return gen.format === 'timestamp' ? Date.parse(iso) : gen.format === 'date' ? iso.slice(0, 10) : iso;
  }
  if (gen.kind === 'increment') return gen.start ?? 1;

  const faker = fakerZH_CN as Faker & FakerLike;
  if (gen.kind === 'faker') {
    faker.seed(fieldSeed(opSeed, path));
    return callFakerPath(faker, gen.method);
  }
  // template
  return gen.template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, expr: string) => {
    faker.seed(fieldSeed(opSeed, `${path}#${expr}`));
    return String(callFakerPath(faker, expr.trim()));
  });
}

function callFakerPath(faker: Faker & FakerLike, methodPath: string): unknown {
  const parts = methodPath.split('.');
  let obj: unknown = faker;
  for (const p of parts.slice(0, -1)) obj = (obj as Record<string, unknown>)?.[p];
  const fn = (obj as Record<string, unknown>)?.[parts[parts.length - 1]!];
  return typeof fn === 'function' ? (fn as () => unknown).call(obj) : '';
}


function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
