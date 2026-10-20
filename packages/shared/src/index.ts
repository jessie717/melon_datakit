/**
 * melon_datakit 共享类型 —— server / web / core 全链路契约。
 * 任何跨端 DTO 都定义在这里，禁止各自复制一份。
 */

// ============ 基础 ============

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type StreamKind = 'upload' | 'download' | 'sse';

export type ValidationMode = 'strict' | 'lenient' | 'off';

/** OAS 3.0 已归一化为 JSON Schema 的宽松结构 */
export type JsonSchema = Record<string, unknown>;

// ============ 路由模型（spec 解析产物） ============

export interface ParamSpec {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
}

export interface RequestBodySpec {
  contentType: string;
  required: boolean;
  schema: JsonSchema;
}

export interface ResponseSpec {
  status: number;
  contentType: string;
  schema: JsonSchema;
  /** spec 里给的 example / examples（优先于生成） */
  example?: unknown;
}

export interface RouteModel {
  id: string;
  method: HttpMethod;
  /** OpenAPI 模板路径，如 /users/{id} */
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  params: ParamSpec[];
  requestBody?: RequestBodySpec;
  /** 按状态码索引的响应定义 */
  responses: ResponseSpec[];
  /** 默认成功响应状态码（最低 2XX） */
  successStatus: number;
  streaming?: StreamKind;
  /** 状态化 CRUD 语义（推断产物，可人工修正） */
  crud?: CrudBinding;
  /** schema 指纹，变更检测用 */
  schemaHash: string;
}

/** CRUD 语义绑定 —— 从路径+方法推断，落库后可 UI 修正 */
export interface CrudBinding {
  kind: 'list' | 'create' | 'get' | 'update' | 'delete' | 'none';
  /** 实体资源类型，如 users */
  resourceType?: string;
  /** 路径里标识实体主键的参数名，如 id */
  idParam?: string;
  /** 列表响应里数组所在的字段路径（data.items / list / 顶层空串） */
  listEnvelope?: string;
  /** 实体主键字段名，默认 id */
  idField: string;
}

// ============ Mock 规则 ============

/** 字段覆盖的生成器描述 —— 统一模型，禁止多套机制并存 */
export type FieldGenerator =
  | { kind: 'literal'; value: unknown }
  | { kind: 'faker'; method: string; args?: unknown[] }
  | { kind: 'template'; template: string }
  | { kind: 'increment'; start?: number; step?: number }
  | { kind: 'now'; format?: 'iso' | 'timestamp' | 'date' };

export interface FieldOverride {
  /** JSONPath 风格字段路径，如 user.name 或 items[0].price */
  path: string;
  generator: FieldGenerator;
}

export interface MockRule {
  id: string;
  projectId: string;
  method: HttpMethod;
  path: string;
  enabled: boolean;
  /** 人为延迟（毫秒） */
  latencyMs?: number;
  /** 0~1，命中时返回 errorStatus */
  errorRate?: number;
  errorStatus?: number;
  errorBody?: unknown;
  /** 强制状态码 */
  statusOverride?: number;
  /** 整响应静态覆盖（最高优先级） */
  bodyStatic?: unknown;
  /** 局部 patch */
  bodyPatch?: Record<string, unknown>;
  fieldOverrides: FieldOverride[];
  /** 固定 seed（可复现某次响应） */
  seed?: number;
  /** 校验模式覆盖 */
  validationMode?: ValidationMode;
  /** 备注 */
  note?: string;
}

/**
 * 响应装配优先级链（定死，禁止另行发明）：
 * bodyStatic > bodyPatch > fieldOverrides > spec example > schema 生成
 */
export const RESPONSE_PRIORITY = [
  'bodyStatic',
  'bodyPatch',
  'fieldOverrides',
  'specExample',
  'schemaGenerated',
] as const;

// ============ 项目 / Spec ============

export interface ProjectConfig {
  locale: 'zh_CN' | 'en';
  validationMode: ValidationMode;
  /** 默认延迟，作用于所有无规则路由 */
  defaultLatencyMs: number;
  defaultErrorRate: number;
  seedSalt: string;
  logRetentionDays: number;
  /** 首次访问播种条数 */
  seedEntitiesCount: number;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  locale: 'zh_CN',
  validationMode: 'lenient',
  defaultLatencyMs: 0,
  defaultErrorRate: 0,
  seedSalt: 'datakit-dev-salt',
  logRetentionDays: 7,
  seedEntitiesCount: 10,
};

export interface Project {
  id: string;
  name: string;
  /** mock 流量挂载点，如 /p/my-app */
  slug: string;
  description?: string;
  config: ProjectConfig;
  createdAt: string;
  updatedAt: string;
}

export type SpecSourceType = 'url' | 'file';

export interface SpecRecord {
  id: string;
  projectId: string;
  sourceType: SpecSourceType;
  sourceUri: string;
  openapiVersion: string;
  checksum: string;
  isActive: boolean;
  importedAt: string;
  /** 解析失败时的错误信息 */
  parseError?: string;
}

// ============ 实体存储 ============

export interface EntityRecord {
  id: string;
  projectId: string;
  resourceType: string;
  resourceKey: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============ 请求日志 ============

export interface RequestLogEntry {
  id: string;
  projectId: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
  latencyMs: number;
  matchedRouteId?: string;
  /** 校验失败/内部错误 */
  error?: string;
  /** 本次生成所用 seed（复现用） */
  seed?: number;
  createdAt: string;
}

// ============ 管理 API DTO ============

export interface HealthResponse {
  ok: boolean;
  version: string;
  db: 'up' | 'down';
  uptimeSec: number;
}

export interface CreateProjectRequest {
  name: string;
  slug: string;
  description?: string;
  config?: Partial<ProjectConfig>;
}

export interface ImportSpecRequest {
  sourceType: SpecSourceType;
  /** sourceType=url 时为 URL；file 时由 multipart 上传 */
  sourceUri?: string;
}

export interface ImportSpecResponse {
  specId: string;
  routeCount: number;
  openapiVersion: string;
  /** 路径冲突等警告 */
  warnings: string[];
}

export interface RouteSummary {
  id: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  tags: string[];
  crudKind: CrudBinding['kind'];
  streaming?: StreamKind;
  schemaChanged?: boolean;
}

export interface EntityListResponse {
  resourceType: string;
  total: number;
  page: number;
  pageSize: number;
  items: EntityRecord[];
}

export interface LogListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: RequestLogEntry[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: Array<{
    in?: string;
    name?: string;
    keyword?: string;
    message: string;
  }>;
}
