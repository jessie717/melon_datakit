/**
 * 状态化 CRUD 请求处理 —— 把 REST 语义路由落到实体存储。
 *
 * 语义来自 Phase 1 的 CrudBinding 推断（可 UI 修正）：
 *   GET /users        → list   SELECT（分页/过滤）
 *   POST /users       → create INSERT（请求体 + schema 补全）
 *   GET /users/{id}   → get    SELECT by key（缺 → 404）
 *   PUT/PATCH {id}    → update UPDATE（body 合并）
 *   DELETE /users/{id}→ delete DELETE（缺 → 404）
 * 非 REST 路由（kind: none）→ 返回 null，由调用方走无状态生成。
 */
import {
  buildListResponse,
  deepMerge,
  fieldSeed,
  filterEntities,
  generateFromSchema,
  itemSchemaOf,
  optionalPresent,
  parsePagination,
  type MockValueOptions,
} from '@datakit/core';
import type { MockRule, ProjectConfig, ResponseSpec, RouteModel } from '@datakit/shared';
import {
  countEntities,
  createEntity,
  deleteEntity,
  ensureSeeded,
  findEntity,
  listEntities,
  updateEntity,
} from './state';

export interface StatefulInput {
  route: RouteModel;
  projectId: string;
  config: ProjectConfig;
  rule?: MockRule;
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  opSeed: number;
}

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers:
      status === 204
        ? headers
        : { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function pickResponse(route: RouteModel): ResponseSpec | undefined {
  return (
    route.responses.find((r) => r.status === route.successStatus) ??
    route.responses.find((r) => r.status >= 200 && r.status < 300) ??
    route.responses[0]
  );
}

/** 实体不存在的 404 —— spec 定义了 404 形状就套用 */
function notFoundResponse(input: StatefulInput, key: string): Response {
  const spec404 = input.route.responses.find((r) => r.status === 404);
  if (spec404) {
    const body =
      spec404.example ??
      generateFromSchema(spec404.schema, {
        opSeed: input.opSeed,
        locale: input.config.locale,
      }) ?? { error: 'not_found' };
    return json(404, body, { 'x-mock-state': 'miss' });
  }
  return json(
    404,
    { error: 'not_found', message: `资源 ${input.route.crud?.resourceType}/${key} 不存在` },
    { 'x-mock-state': 'miss' }
  );
}

export async function handleStateful(input: StatefulInput): Promise<Response | null> {
  const { route, config, rule } = input;
  const crud = route.crud;
  if (!crud || crud.kind === 'none' || !crud.resourceType) return null;

  const resourceType = crud.resourceType;
  const idField = crud.idField ?? 'id';
  const genOptions: Partial<MockValueOptions> = {
    ...(rule?.fieldOverrides?.length ? { fieldOverrides: rule.fieldOverrides } : {}),
  };

  const response = pickResponse(route);

  switch (crud.kind) {
    case 'list': {
      const envelope = crud.listEnvelope ?? '';
      const itemSchema = itemSchemaOf(response?.schema, envelope);
      await ensureSeeded({
        projectId: input.projectId,
        resourceType,
        itemSchema,
        config,
        idField,
        genOptions,
      });

      let items = await listEntities(input.projectId, resourceType);
      const pagination = parsePagination(input.query);
      items = filterEntities(items, input.query, pagination.pageKeys);
      const sliced =
        pagination.limit !== undefined
          ? items.slice(pagination.offset, pagination.offset + pagination.limit)
          : items.slice(pagination.offset);

      // 信封结构从响应 schema 生成（保留 code/total 等兄弟字段），再填真实实体
      const { assembleResponse } = await import('@datakit/core');
      const base = assembleResponse(response?.schema, {
        opSeed: input.opSeed,
        locale: config.locale,
        ...(response?.example !== undefined ? { example: response.example } : {}),
        ...genOptions,
      });
      const body = buildListResponse(base, envelope, sliced.map((e) => e.data), items.length);
      return json(route.successStatus || 200, body, {
        'x-mock-state': 'hit',
        'x-mock-total': String(items.length),
      });
    }

    case 'get': {
      const key = String(input.params[crud.idParam ?? 'id'] ?? '');
      // 详情先行时也保证种子数据存在
      await ensureSeeded({
        projectId: input.projectId,
        resourceType,
        itemSchema: response?.schema,
        config,
        idField,
        genOptions,
      });
      const entity = await findEntity(input.projectId, resourceType, key);
      if (!entity) return notFoundResponse(input, key);
      return json(route.successStatus || 200, entity.data, { 'x-mock-state': 'hit' });
    }

    case 'create': {
      const { assembleResponse } = await import('@datakit/core');
      const generated = (assembleResponse(response?.schema, {
        opSeed: input.opSeed,
        locale: config.locale,
        ...(response?.example !== undefined ? { example: response.example } : {}),
        ...genOptions,
      }) ?? {}) as Record<string, unknown>;
      // 请求体覆盖生成字段（用户提交优先）
      const data = (deepMerge(generated, input.body ?? {}) ?? {}) as Record<string, unknown>;
      const bodyId = input.body ? (input.body as Record<string, unknown>)[idField] : undefined;
      const key = String(bodyId ?? data[idField] ?? crypto.randomUUID());
      data[idField] = key;
      await createEntity(input.projectId, resourceType, key, data);
      return json(route.successStatus || 201, data, { 'x-mock-state': 'created' });
    }

    case 'update': {
      const key = String(input.params[crud.idParam ?? 'id'] ?? '');
      const entity = await findEntity(input.projectId, resourceType, key);
      if (!entity) return notFoundResponse(input, key);
      // PUT/PATCH 都做合并（body 优先）—— 调试场景下比整体替换更稳
      const data = (deepMerge(entity.data, input.body ?? {}) ?? entity.data) as Record<string, unknown>;
      data[idField] = key;
      await updateEntity(input.projectId, resourceType, key, data);
      return json(route.successStatus || 200, data, { 'x-mock-state': 'updated' });
    }

    case 'delete': {
      const key = String(input.params[crud.idParam ?? 'id'] ?? '');
      const existed = await deleteEntity(input.projectId, resourceType, key);
      if (!existed) return notFoundResponse(input, key);
      const status = route.successStatus || 204;
      return json(status, status === 204 ? null : { ok: true }, { 'x-mock-state': 'deleted' });
    }
  }

  return null;
}

/** 供 dispatcher 判断「该资源类型是否已有数据」（种子状态显示用） */
export { countEntities, optionalPresent, fieldSeed };
