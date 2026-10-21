/**
 * 管理 API —— 实体浏览 / 重置（状态化 CRUD 的数据面）。
 */
import { Elysia, t } from 'elysia';
import type { EntityListResponse, EntityRecord } from '@datakit/shared';
import {
  countEntities,
  listEntities,
  listResourceTypes,
  resetEntities,
  updateEntity,
} from '../engine/state';
import { getProjectRow } from './projects';

export const entitiesAdmin = new Elysia({ prefix: '/_datakit/admin' })
  // 资源类型清单（含条数）
  .get('/projects/:id/entities/types', async ({ params, set }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    return listResourceTypes(params.id);
  })
  // 实体浏览（按 resource_type，分页）
  .get(
    '/projects/:id/entities',
    async ({ params, query, set }): Promise<EntityListResponse | { error: string; message: string }> => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const resourceType = query.resourceType;
      if (!resourceType) {
        set.status = 400;
        return { error: 'bad_request', message: '缺少 resourceType 参数' };
      }
      const page = Math.max(1, Number(query.page ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 50) || 50));

      const total = await countEntities(params.id, resourceType);
      const all = await listEntities(params.id, resourceType);
      const items = all.slice((page - 1) * pageSize, page * pageSize).map(
        (e): EntityRecord => ({
          id: e.id,
          projectId: params.id,
          resourceType,
          resourceKey: e.resourceKey,
          data: e.data,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })
      );
      return { resourceType, total, page, pageSize, items };
    },
    {
      query: t.Object({
        resourceType: t.String(),
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
    }
  )
  // 重置数据（回到种子态 —— 下次访问惰性重播种）
  .post(
    '/projects/:id/entities/reset',
    async ({ params, body }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const deleted = await resetEntities(params.id, body?.resourceType ?? undefined);
      return { ok: true, deleted };
    },
    {
      body: t.Optional(t.Object({ resourceType: t.Optional(t.String()) })),
    }
  )
  // 编辑单条实体（数据浏览器用）
  .patch(
    '/projects/:id/entities',
    async ({ params, body, set }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const row = await updateEntity(params.id, body.resourceType, body.resourceKey, body.data);
      if (!row) {
        set.status = 404;
        return { error: 'not_found', message: `实体 ${body.resourceType}/${body.resourceKey} 不存在` };
      }
      return {
        id: row.id,
        projectId: params.id,
        resourceType: body.resourceType,
        resourceKey: row.resourceKey,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
    {
      body: t.Object({
        resourceType: t.String(),
        resourceKey: t.String(),
        data: t.Record(t.String(), t.Unknown()),
      }),
    }
  );

export type EntitiesAdmin = typeof entitiesAdmin;
