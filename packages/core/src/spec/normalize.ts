/**
 * Spec 归一化 —— 解析后的 OpenAPI/Swagger 文档 → RouteModel[]。
 *
 * 处理差异：
 * - Swagger 2.0：body 参数 → requestBody；formData → multipart；basePath 拼接
 * - OAS 3.0：nullable → JSON Schema 的 type 数组；剥离 discriminator/xml 噪音
 * - readOnly（响应）/ writeOnly（请求）字段剥离
 * - 响应按 status code 组织，example 单独抽出（生成时优先）
 */
import type {
  HttpMethod,
  JsonSchema,
  ParamSpec,
  RequestBodySpec,
  ResponseSpec,
  RouteModel,
} from '@datakit/shared';
import { detectListEnvelope, inferCrud, inferStreaming } from './infer';
import { schemaHash } from './hash';

const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface NormalizeResult {
  routes: RouteModel[];
  warnings: string[];
  openapiVersion: string;
}

export function normalizeSpec(spec: Record<string, unknown>): NormalizeResult {
  const warnings: string[] = [];
  const isSwagger2 = typeof spec['swagger'] === 'string';
  const openapiVersion = String(spec['swagger'] ?? spec['openapi'] ?? 'unknown');

  const rawPaths = spec['paths'];
  if (!rawPaths || typeof rawPaths !== 'object') {
    return { routes: [], warnings: ['spec 无 paths 定义'], openapiVersion };
  }

  // Swagger 2.0 basePath / OAS servers[0].url 的路径部分
  const prefix = isSwagger2
    ? String(spec['basePath'] ?? '')
    : extractServerPath(spec);

  // 全局 produces/consumes（Swagger 2.0）
  const globalProduces = toStringArray(spec['produces']);
  const globalConsumes = toStringArray(spec['consumes']);

  // 组件级参数（OAS 3 的 components.parameters / Swagger 2 的 parameters 不能全局引用，
  // dereference 后 $ref 已内联，这里不用管）

  const routes: RouteModel[] = [];

  for (const [rawPath, rawItem] of Object.entries(
    rawPaths as Record<string, unknown>
  )) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;

    // path 级公共参数（OAS 与 Swagger 2 都支持）
    const pathLevelParams = toParamArray(item['parameters']);

    for (const method of METHODS) {
      const op = item[method.toLowerCase()];
      if (!op || typeof op !== 'object') continue;
      const operation = op as Record<string, unknown>;

      const fullPath = joinPath(prefix, rawPath);
      const params = mergeParams(
        pathLevelParams,
        toParamArray(operation['parameters'])
      );

      // requestBody：OAS3 的 requestBody / Swagger2 的 in:body|formData
      const { body, warnings: bodyWarn } = isSwagger2
        ? extractSwagger2Body(operation, params, globalConsumes)
        : extractOas3Body(operation);
      warnings.push(...bodyWarn);

      // 从 params 里去掉已并入 body 的（Swagger2 的 body/formData 参数）
      const finalParams = params.filter(
        (p) => p.in === 'path' || p.in === 'query' || p.in === 'header'
      );

      // responses
      const { responses, successStatus, warnings: resWarn } = extractResponses(
        operation['responses'],
        isSwagger2 ? globalProduces : [],
        isSwagger2
      );
      warnings.push(...resWarn);

      // 流式检测
      const streaming = inferStreaming({
        requestBodyContentTypes: body ? [body.contentType] : [],
        requestBodySchemas: body ? [body.schema] : [],
        responseContentTypes: responses.map((r) => r.contentType),
        responseSchemas: responses.map((r) => r.schema),
      });

      // 列表信封（用于 CRUD 推断）
      const successRes = responses.find((r) => r.status === successStatus);
      const listEnvelope = detectListEnvelope(successRes?.schema);

      // CRUD 推断 —— 用 spec 原始路径（不含 servers/basePath 前缀），
      // 资源语义来自 spec 自身，/v2/pets 这类前缀不应影响分段判定
      const crud = inferCrud(rawPath, method, listEnvelope);

      const responseSchemaMap: Record<string, unknown> = {};
      for (const r of responses) {
        responseSchemaMap[String(r.status)] = {
          contentType: r.contentType,
          schema: r.schema,
          ...(r.example !== undefined ? { example: r.example } : {}),
        };
      }

      const requestSchema = {
        params: finalParams.filter((p) => p.in === 'path'),
        query: finalParams.filter((p) => p.in === 'query'),
        headers: finalParams.filter((p) => p.in === 'header'),
        ...(body ? { body: { contentType: body.contentType, schema: body.schema, required: body.required } } : {}),
      };

      routes.push({
        id: `${method} ${fullPath}`,
        method,
        path: fullPath,
        operationId: optionalString(operation['operationId']),
        summary: optionalString(operation['summary']),
        description: optionalString(operation['description']),
        tags: toStringArray(operation['tags']),
        params: finalParams,
        ...(body ? { requestBody: body } : {}),
        responses,
        successStatus,
        ...(streaming ? { streaming } : {}),
        crud,
        schemaHash: schemaHash({ requestSchema, responseSchemaMap }),
      });
    }
  }

  return { routes, warnings, openapiVersion };
}

// ============ 路径 ============

function joinPath(prefix: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const pre = (prefix ?? '').replace(/\/$/, '');
  if (!pre || pre === '/') return p;
  return `${pre.startsWith('/') ? pre : `/${pre}`}${p}`;
}

function extractServerPath(spec: Record<string, unknown>): string {
  const servers = spec['servers'];
  if (!Array.isArray(servers) || servers.length === 0) return '';
  const first = servers[0];
  if (!first || typeof first !== 'object') return '';
  const url = (first as Record<string, unknown>)['url'];
  if (typeof url !== 'string') return '';
  try {
    // 可能是相对路径，也可能是完整 URL
    if (url.startsWith('/')) return url.replace(/\/$/, '');
    const u = new URL(url);
    return u.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

// ============ 参数 ============

function toParamArray(value: unknown): ParamSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ParamSpec[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = p['name'];
    const loc = p['in'];
    if (typeof name !== 'string' || typeof loc !== 'string') continue;
    if (loc !== 'path' && loc !== 'query' && loc !== 'header') continue;
    out.push({
      name,
      in: loc,
      required: loc === 'path' ? true : p['required'] === true,
      schema: normalizeSchema(p['schema'] ?? { type: 'string' }),
    });
  }
  return out;
}

function mergeParams(a: ParamSpec[], b: ParamSpec[]): ParamSpec[] {
  const seen = new Map<string, ParamSpec>();
  for (const p of [...a, ...b]) {
    seen.set(`${p.in}:${p.name}`, p);
  }
  return [...seen.values()];
}

// ============ 请求体 ============

interface BodyResult {
  body?: RequestBodySpec;
  warnings: string[];
}

function extractOas3Body(operation: Record<string, unknown>): BodyResult {
  const rb = operation['requestBody'];
  if (!rb || typeof rb !== 'object') return { warnings: [] };
  const requestBody = rb as Record<string, unknown>;
  const content = requestBody['content'];
  if (!content || typeof content !== 'object') return { warnings: [] };

  const entries = Object.entries(content as Record<string, unknown>);
  if (entries.length === 0) return { warnings: [] };

  // 优先 json，其次第一个
  const preferred =
    entries.find(([type]) => type.toLowerCase().includes('json')) ?? entries[0]!;
  const [contentType, mediaObj] = preferred;
  const schema =
    (mediaObj as Record<string, unknown>)['schema'] ?? ({} as JsonSchema);

  return {
    body: {
      contentType,
      required: requestBody['required'] === true,
      schema: normalizeSchema(schema, 'request'),
    },
    warnings: [],
  };
}

function extractSwagger2Body(
  operation: Record<string, unknown>,
  params: ParamSpec[],
  globalConsumes: string[]
): BodyResult {
  const warnings: string[] = [];
  const raw = operation['parameters'];
  if (!Array.isArray(raw)) return { warnings };

  let body: RequestBodySpec | undefined;
  const formFields: ParamSpec[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const loc = p['in'];
    if (loc === 'body') {
      body = {
        contentType:
          toStringArray(operation['consumes'])[0] ?? globalConsumes[0] ?? 'application/json',
        required: p['required'] === true,
        schema: normalizeSchema(p['schema'] ?? {}, 'request'),
      };
    } else if (loc === 'formData') {
      const name = p['name'];
      if (typeof name === 'string') {
        formFields.push({
          name,
          in: 'query', // 临时；下面统一转 body
          required: p['required'] === true,
          schema: normalizeSchema(
            p['schema'] ?? { type: p['type'] ?? 'string' },
            'request'
          ),
        });
      }
    }
  }

  // formData → multipart body
  if (formFields.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of formFields) {
      properties[f.name] = f.schema;
      if (f.required) required.push(f.name);
    }
    body = {
      contentType: 'multipart/form-data',
      required: required.length > 0,
      schema: normalizeSchema(
        { type: 'object', properties, ...(required.length ? { required } : {}) },
        'request'
      ),
    };
    warnings.push(
      `Swagger 2.0 formData 参数已转换为 multipart 请求体（${formFields.map((f) => f.name).join(', ')}）`
    );
  }

  return { body, warnings };
}

// ============ 响应 ============

interface ResponsesResult {
  responses: ResponseSpec[];
  successStatus: number;
  warnings: string[];
}

function extractResponses(
  raw: unknown,
  globalProduces: string[],
  isSwagger2: boolean
): ResponsesResult {
  const warnings: string[] = [];
  const responses: ResponseSpec[] = [];

  if (!raw || typeof raw !== 'object') {
    return { responses, successStatus: 200, warnings: ['操作无 responses 定义'] };
  }

  for (const [statusStr, rawRes] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (statusStr === 'default') {
      // default 响应按 500 归档（多用于错误）
      continue;
    }
    const status = Number(statusStr);
    if (!Number.isInteger(status)) continue;
    if (!rawRes || typeof rawRes !== 'object') continue;
    const res = rawRes as Record<string, unknown>;

    if (isSwagger2) {
      // Swagger 2.0：schema 平铺在响应对象上
      const schema = res['schema'];
      if (schema && typeof schema === 'object') {
        responses.push({
          status,
          contentType:
            toStringArray(res['produces'])[0] ?? globalProduces[0] ?? 'application/json',
          schema: normalizeSchema(schema, 'response'),
          ...(extractExample(res) !== undefined
            ? { example: extractExample(res) }
            : {}),
        });
      } else {
        responses.push({
          status,
          contentType: 'application/json',
          schema: { type: 'null' } as JsonSchema,
        });
      }
    } else {
      // OAS 3.x：content.{type}.schema
      const content = res['content'];
      if (content && typeof content === 'object') {
        const entries = Object.entries(content as Record<string, unknown>);
        const preferred =
          entries.find(([type]) => type.toLowerCase().includes('json')) ??
          entries[0];
        if (preferred) {
          const [contentType, mediaObj] = preferred;
          const media = (mediaObj ?? {}) as Record<string, unknown>;
          const schema = media['schema'];
          responses.push({
            status,
            contentType,
            schema: normalizeSchema(schema ?? {}, 'response'),
            ...(extractExample(media) !== undefined
              ? { example: extractExample(media) }
              : {}),
          });
        }
      } else {
        // 无 content（204 等）
        responses.push({
          status,
          contentType: 'application/json',
          schema: { type: 'null' } as JsonSchema,
        });
      }
    }
  }

  // 默认成功状态码：最低 2xx，否则 200
  const twos = responses.filter((r) => r.status >= 200 && r.status < 300);
  const successStatus =
    twos.length > 0 ? Math.min(...twos.map((r) => r.status)) : 200;

  return { responses, successStatus, warnings };
}

function extractExample(obj: Record<string, unknown>): unknown {
  if ('example' in obj && obj['example'] !== undefined) return obj['example'];
  const examples = obj['examples'];
  if (examples && typeof examples === 'object') {
    const first = Object.values(examples as Record<string, unknown>)[0];
    if (first && typeof first === 'object') {
      const v = (first as Record<string, unknown>)['value'];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

// ============ Schema 归一化 ============

type SchemaMode = 'request' | 'response';

/**
 * OAS Schema → JSON Schema：
 * - nullable: true → type: [type, 'null']
 * - 剥离噪音：discriminator / xml / externalDocs / example(s) / deprecated
 * - readOnly 字段从**请求** schema 剥离（不允许客户端提交）
 * - writeOnly 字段从**响应** schema 剥离（不允许返回给客户端）
 */
export function normalizeSchema(
  schema: unknown,
  mode: SchemaMode = 'response',
  depth = 0
): JsonSchema {
  if (!schema || typeof schema !== 'object' || depth > 32) {
    return {} as JsonSchema;
  }
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(s)) {
    // 噪音字段不进内部模型
    if (
      key === 'discriminator' ||
      key === 'xml' ||
      key === 'externalDocs' ||
      key === 'example' ||
      key === 'examples' ||
      key === 'deprecated' ||
      key === 'x-*'
    ) {
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, unknown>
      )) {
        const ps = propSchema as Record<string, unknown>;
        // readOnly 不允许提交（请求剥离）；writeOnly 不允许返回（响应剥离）
        if (mode === 'request' && ps?.['readOnly'] === true) continue;
        if (mode === 'response' && ps?.['writeOnly'] === true) continue;
        props[propName] = normalizeSchema(propSchema, mode, depth + 1);
      }
      out['properties'] = props;
      continue;
    }

    if (key === 'items') {
      out['items'] = normalizeSchema(value, mode, depth + 1);
      continue;
    }

    if (key === 'required' && Array.isArray(value)) {
      // readOnly/writeOnly 剥离后 required 里可能有孤儿
      continue; // 下面统一处理
    }

    if (
      key === 'allOf' ||
      key === 'anyOf' ||
      key === 'oneOf' ||
      key === 'prefixItems'
    ) {
      if (Array.isArray(value)) {
        out[key] = value.map((v) => normalizeSchema(v, mode, depth + 1));
      }
      continue;
    }

    if (
      key === 'additionalProperties' ||
      key === 'not' ||
      key === 'if' ||
      key === 'then' ||
      key === 'else' ||
      key === 'propertyNames'
    ) {
      if (value && typeof value === 'object') {
        out[key] = normalizeSchema(value, mode, depth + 1);
      } else {
        out[key] = value;
      }
      continue;
    }

    out[key] = value;
  }

  // nullable → type 数组
  if (s['nullable'] === true) {
    delete out['nullable'];
    const t = out['type'];
    if (typeof t === 'string') {
      out['type'] = [t, 'null'];
    } else if (!t) {
      out['type'] = ['null'];
    }
  }

  // required 清理（只保留 properties 里还存在的字段）
  const required = s['required'];
  if (Array.isArray(required) && out['properties']) {
    const props = out['properties'] as Record<string, unknown>;
    const kept = (required as unknown[]).filter(
      (r) => typeof r === 'string' && r in props
    );
    if (kept.length > 0) out['required'] = kept;
  } else if (Array.isArray(required)) {
    out['required'] = required;
  }

  // readOnly/writeOnly 标记本身不进模型
  delete out['readOnly'];
  delete out['writeOnly'];

  return out as JsonSchema;
}

// ============ 工具 ============

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
