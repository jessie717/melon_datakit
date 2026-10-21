/**
 * 管理 API 客户端 —— 全部走相对路径 /_datakit/admin/*（由 next rewrites 代理）。
 */

export interface ProjectConfig {
  locale: 'zh_CN' | 'en';
  validationMode: 'strict' | 'lenient' | 'off';
  defaultLatencyMs: number;
  defaultErrorRate: number;
  seedSalt: string;
  logRetentionDays: number;
  seedEntitiesCount: number;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  config: ProjectConfig;
  createdAt: string;
  updatedAt: string;
}

export interface SpecRecord {
  id: string;
  projectId: string;
  sourceType: 'url' | 'file';
  sourceUri: string;
  openapiVersion: string;
  checksum: string;
  isActive: boolean;
  importedAt: string;
  parseError?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type StreamKind = 'upload' | 'download' | 'sse';
export type CrudKind = 'list' | 'create' | 'get' | 'update' | 'delete' | 'none';

export interface RouteSummary {
  id: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  tags: string[];
  crudKind: CrudKind;
  streaming?: StreamKind;
}

export interface ParamSpec {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: Record<string, unknown>;
}

export interface RequestBodySpec {
  contentType: string;
  required: boolean;
  schema: Record<string, unknown>;
}

export interface ResponseSpec {
  status: number;
  contentType: string;
  schema: Record<string, unknown>;
  example?: unknown;
}

export interface CrudBinding {
  kind: CrudKind;
  resourceType?: string;
  idParam?: string;
  listEnvelope?: string;
  idField: string;
}

export interface RouteModel {
  id: string;
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  params: ParamSpec[];
  requestBody?: RequestBodySpec;
  responses: ResponseSpec[];
  successStatus: number;
  streaming?: StreamKind;
  crud?: CrudBinding;
  schemaHash: string;
}


export interface MockRule {
  id: string;
  projectId: string;
  method: HttpMethod;
  path: string;
  enabled: boolean;
  latencyMs?: number;
  errorRate?: number;
  errorStatus?: number;
  errorBody?: unknown;
  statusOverride?: number;
  bodyStatic?: unknown;
  bodyPatch?: Record<string, unknown>;
  fieldOverrides: Array<{ path: string; generator: Record<string, unknown> }>;
  seed?: number;
  validationMode?: 'strict' | 'lenient' | 'off';
  note?: string;
}

export interface EntityRecord {
  id: string;
  projectId: string;
  resourceType: string;
  resourceKey: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
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
  error?: string;
  seed?: number;
  createdAt: string;
}

export interface ImportSpecResponse {
  specId: string;
  routeCount: number;
  openapiVersion: string;
  warnings: string[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: Array<{ message: string }>;
}

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiError
  ) {
    super(payload.message || `请求失败（HTTP ${status}）`);
    this.name = 'RequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new RequestError(res.status, (data ?? { error: 'unknown', message: text }) as ApiError);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string; db: string; uptimeSec: number }>('/_datakit/admin/health'),

  listProjects: () => request<Project[]>('/_datakit/admin/projects'),
  getProject: (id: string) => request<Project>(`/_datakit/admin/projects/${id}`),
  createProject: (body: { name: string; slug: string; description?: string }) =>
    request<Project>('/_datakit/admin/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/_datakit/admin/projects/${id}`, { method: 'DELETE' }),

  listSpecs: (projectId: string) => request<SpecRecord[]>(`/_datakit/admin/projects/${projectId}/specs`),
  importSpecUrl: (projectId: string, sourceUri: string) =>
    request<ImportSpecResponse>(`/_datakit/admin/projects/${projectId}/specs`, {
      method: 'POST',
      body: JSON.stringify({ sourceType: 'url', sourceUri }),
    }),
  importSpecFile: (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportSpecResponse>(`/_datakit/admin/projects/${projectId}/specs/file`, {
      method: 'POST',
      body: form,
    });
  },

  listRoutes: (projectId: string) =>
    request<RouteModel[]>(`/_datakit/admin/projects/${projectId}/routes`),
  listRouteSummaries: (projectId: string) =>
    request<RouteSummary[]>(`/_datakit/admin/projects/${projectId}/routes/summary`),

  listRules: (projectId: string) =>
    request<MockRule[]>(`/_datakit/admin/projects/${projectId}/rules`),
  upsertRule: (
    projectId: string,
    rule: Partial<MockRule> & { method: string; path: string }
  ) =>
    request<MockRule>(`/_datakit/admin/projects/${projectId}/rules`, {
      method: 'PUT',
      body: JSON.stringify(rule),
    }),
  deleteRule: (projectId: string, ruleId: string) =>
    request<{ ok: boolean }>(`/_datakit/admin/projects/${projectId}/rules/${ruleId}`, {
      method: 'DELETE',
    }),

  listEntityTypes: (projectId: string) =>
    request<Array<{ resourceType: string; count: number }>>(
      `/_datakit/admin/projects/${projectId}/entities/types`
    ),
  listEntities: (projectId: string, resourceType: string, page = 1, pageSize = 50) =>
    request<{
      resourceType: string;
      total: number;
      page: number;
      pageSize: number;
      items: EntityRecord[];
    }>(
      `/_datakit/admin/projects/${projectId}/entities?resourceType=${encodeURIComponent(
        resourceType
      )}&page=${page}&pageSize=${pageSize}`
    ),
  updateEntity: (
    projectId: string,
    body: { resourceType: string; resourceKey: string; data: Record<string, unknown> }
  ) =>
    request<EntityRecord>(`/_datakit/admin/projects/${projectId}/entities`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  resetEntities: (projectId: string, resourceType?: string) =>
    request<{ ok: boolean; deleted: number }>(
      `/_datakit/admin/projects/${projectId}/entities/reset`,
      {
        method: 'POST',
        body: JSON.stringify(resourceType ? { resourceType } : {}),
      }
    ),

  listLogs: (
    projectId: string,
    params: { page?: number; pageSize?: number; method?: string; status?: number } = {}
  ) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.method) q.set('method', params.method);
    if (params.status) q.set('status', String(params.status));
    return request<{
      total: number;
      page: number;
      pageSize: number;
      items: LogEntry[];
    }>(`/_datakit/admin/projects/${projectId}/logs?${q.toString()}`);
  },
  clearLogs: (projectId: string) =>
    request<{ ok: boolean; deleted: number }>(`/_datakit/admin/projects/${projectId}/logs`, {
      method: 'DELETE',
    }),

  updateProject: (
    id: string,
    body: {
      name?: string;
      slug?: string;
      description?: string;
      config?: Partial<ProjectConfig>;
    }
  ) =>
    request<Project>(`/_datakit/admin/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

/** Mock 流量 Base URL，前端项目把 baseURL 指到这里 */
export function mockBaseUrl(slug: string, origin?: string): string {
  const base = typeof window === 'undefined' ? '' : (origin ?? window.location.origin);
  return `${base.replace(/\/$/, '')}/p/${slug}`;
}

/** 相对 mock 路径（复制给后端服务地址场景用） */
export function mockPath(slug: string): string {
  return `/p/${slug}`;
}
