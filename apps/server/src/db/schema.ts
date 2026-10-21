/**
 * Drizzle 表结构 —— 通用 mock 平台的持久化模型。
 *
 * 核心思路：实体存储用 JSONB 通用文档表（entities），
 * 不为每个 spec 的 schema 动态建表。
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date());

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().$defaultFn(() => new Date());

// ============ 项目 ============

export const projects = pgTable('projects', {
  id: id(),
  name: text('name').notNull(),
  /** mock 流量挂载点 slug，如 my-app → /p/my-app */
  slug: text('slug').notNull().unique(),
  description: text('description'),
  /** ProjectConfig（locale、validationMode、默认延迟、seedSalt、日志保留…） */
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ============ Spec 文档 ============

export const specs = pgTable(
  'specs',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(), // 'url' | 'file'
    sourceUri: text('source_uri').notNull(),
    /** 归一化后的 spec 内容 */
    content: jsonb('content').notNull().$type<Record<string, unknown>>(),
    openapiVersion: text('openapi_version').notNull(),
    checksum: text('checksum').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    parseError: text('parse_error'),
    importedAt: createdAt(),
  },
  (t) => [
    index('specs_project_idx').on(t.projectId),
    // 普通索引（非唯一）：同内容重复导入是幂等成功，不报错
    index('specs_checksum_idx').on(t.projectId, t.checksum),
  ]
);

// ============ 路由（spec 解析产物） ============

export const routes = pgTable(
  'routes',
  {
    id: id(),
    specId: uuid('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    /** OpenAPI 模板路径：/users/{id} */
    path: text('path').notNull(),
    operationId: text('operation_id'),
    summary: text('summary'),
    tags: jsonb('tags').notNull().$type<string[]>().default([]),
    /** 参数 + body 归一化后的 JSON Schema 结构 */
    requestSchema: jsonb('request_schema').notNull().$type<Record<string, unknown>>(),
    /** 按 status code 组织：{"200": {contentType, schema, example}} */
    responseSchema: jsonb('response_schema').notNull().$type<Record<string, unknown>>(),
    successStatus: integer('success_status').notNull().default(200),
    isStreaming: boolean('is_streaming').notNull().default(false),
    streamKind: text('stream_kind'), // 'upload' | 'download' | 'sse' | null
    /** CRUD 语义绑定（推断产物，可 UI 修正） */
    crud: jsonb('crud').$type<Record<string, unknown>>(),
    /** schema 指纹，变更检测 */
    schemaHash: text('schema_hash').notNull(),
  },
  (t) => [
    uniqueIndex('routes_spec_method_path_idx').on(t.specId, t.method, t.path),
    index('routes_spec_idx').on(t.specId),
  ]
);

// ============ 通用实体存储（状态化 CRUD 核心） ============

export const entities = pgTable(
  'entities',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 从路径推断：/users/{id} → users */
    resourceType: text('resource_type').notNull(),
    /** 实体主键值（路径参数 {id} 的值） */
    resourceKey: text('resource_key').notNull(),
    /** 实体完整内容（任意 schema） */
    data: jsonb('data').notNull().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('entities_project_type_key_idx').on(
      t.projectId,
      t.resourceType,
      t.resourceKey
    ),
    index('entities_project_type_idx').on(t.projectId, t.resourceType),
  ]
);

// ============ Mock 规则 ============

export const mockRules = pgTable(
  'mock_rules',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    latencyMs: integer('latency_ms'),
    errorRate: doublePrecision('error_rate'),
    errorStatus: integer('error_status'),
    errorBody: jsonb('error_body'),
    statusOverride: integer('status_override'),
    /** 整响应静态覆盖 */
    bodyStatic: jsonb('body_static'),
    /** 局部 patch */
    bodyPatch: jsonb('body_patch').$type<Record<string, unknown>>(),
    /** FieldOverride[]：路径 + 生成器描述 */
    fieldOverrides: jsonb('field_overrides').notNull().$type<unknown[]>().default([]),
    seed: integer('seed'),
    validationMode: text('validation_mode'), // 'strict' | 'lenient' | 'off'
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mock_rules_project_method_path_idx').on(t.projectId, t.method, t.path),
    index('mock_rules_project_idx').on(t.projectId),
  ]
);

// ============ 请求日志 ============

export const requestLogs = pgTable(
  'request_logs',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    query: jsonb('query').notNull().$type<Record<string, string>>().default({}),
    headers: jsonb('headers').notNull().$type<Record<string, string>>().default({}),
    requestBody: jsonb('request_body'),
    status: integer('status').notNull(),
    responseBody: jsonb('response_body'),
    latencyMs: integer('latency_ms').notNull(),
    matchedRouteId: uuid('matched_route_id'),
    error: text('error'),
    /** 本次生成所用 seed（复现用） */
    seed: integer('seed'),
    createdAt: createdAt(),
  },
  (t) => [index('request_logs_project_created_idx').on(t.projectId, t.createdAt)]
);

export type ProjectRow = typeof projects.$inferSelect;
export type SpecRow = typeof specs.$inferSelect;
export type RouteRow = typeof routes.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type MockRuleRow = typeof mockRules.$inferSelect;
export type RequestLogRow = typeof requestLogs.$inferSelect;
