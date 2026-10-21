/**
 * 请求校验 —— 按 spec 校验入参（path/query/header/body）。
 *
 * 校验模式三档（项目级配置，可按端点覆盖）：
 *   strict —— 非法即拒（400/422）
 *   lenient（默认）—— 校验但放行，只产生告警（mock 不阻塞前端）
 *   off —— 完全跳过
 *
 * 错误形状（FR-03.4）：
 *   { error: 'validation_error', details: [{ in, name, keyword, message }] }
 */
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { Ajv, ErrorObject } from 'ajv';
import type { JsonSchema, RouteModel, ValidationMode } from '@datakit/shared';

export interface ValidationIssue {
  in: 'path' | 'query' | 'header' | 'body';
  name: string;
  keyword: string;
  message: string;
}

export interface ValidateInput {
  route: RouteModel;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ValidateResult {
  mode: ValidationMode;
  issues: ValidationIssue[];
  /** strict 模式下 issues 非空 → 请求应被拒绝 */
  shouldReject: boolean;
}

let ajv: Ajv | null = null;

function getAjv(): Ajv {
  if (!ajv) {
    const a = new Ajv2020({
      allErrors: true,
      // query/path 参数是字符串，按 schema 类型自动转换（"10" → 10）
      coerceTypes: true,
      strict: false,
      validateFormats: true,
    }) as unknown as Ajv;
    addFormats(a as never);
    ajv = a;
  }
  return ajv;
}

export function validateRequest(input: ValidateInput, mode: ValidationMode): ValidateResult {
  const issues: ValidationIssue[] = [];
  if (mode === 'off') return { mode, issues, shouldReject: false };

  const { route } = input;
  const validator = getAjv();

  const run = (
    where: ValidationIssue['in'],
    names: string[],
    schema: JsonSchema | undefined,
    data: unknown
  ) => {
    if (!schema || Object.keys(schema).length === 0) return;
    try {
      const compiled = validator.compile(schema as object);
      const ok = compiled(data);
      if (!ok && compiled.errors) {
        for (const err of compiled.errors) {
          issues.push(toIssue(where, names, err));
        }
      }
    } catch {
      // schema 无法编译（脏 spec）→ 不阻断 mock，记为告警
      issues.push({
        in: where,
        name: '-',
        keyword: 'schema',
        message: `${where} 的 schema 无法编译，跳过校验`,
      });
    }
  };

  // path / query / header 参数：合成 object schema
  const params = route.params.filter((p) => p.in === 'path');
  const query = route.params.filter((p) => p.in === 'query');
  const headers = route.params.filter((p) => p.in === 'header');

  run('path', params.map((p) => p.name), paramObjectSchema(params), input.params);
  run('query', query.map((p) => p.name), paramObjectSchema(query), input.query);
  run(
    'header',
    headers.map((p) => p.name.toLowerCase()),
    paramObjectSchema(headers.map((h) => ({ ...h, name: h.name.toLowerCase() }))),
    lowercaseKeys(input.headers)
  );

  // body
  if (route.requestBody) {
    const isJson = route.requestBody.contentType.includes('json');
    if (isJson || input.body !== undefined) {
      run('body', [], route.requestBody.schema, input.body ?? undefined);
    }
  }

  return { mode, issues, shouldReject: mode === 'strict' && issues.length > 0 };
}

function paramObjectSchema(
  params: Array<{ name: string; required: boolean; schema: JsonSchema }>
): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = p.schema;
    if (p.required) required.push(p.name);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  } as JsonSchema;
}

function toIssue(
  where: ValidationIssue['in'],
  names: string[],
  err: ErrorObject
): ValidationIssue {
  // instancePath: '/limit' → limit；'/0' → 数组下标
  const path = err.instancePath.replace(/^\//, '').split('/').filter(Boolean);
  const first = path[0];
  const name =
    err.keyword === 'required'
      ? String((err.params as { missingProperty?: string })?.missingProperty ?? first ?? '-')
      : first ?? names[0] ?? '-';
  return {
    in: where,
    name,
    keyword: err.keyword,
    message: err.message ?? '校验失败',
  };
}

function lowercaseKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
}
