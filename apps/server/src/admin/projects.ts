/**
 * 管理 API —— 项目 CRUD（/_datakit/admin/projects）。
 */
import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_PROJECT_CONFIG,
  type CreateProjectRequest,
  type Project,
  type ProjectConfig,
} from '@datakit/shared';
import { checkConflicts } from '@datakit/core';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { dropProject, updateProjectConfig } from '../engine/registry';

export function toProjectDto(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    config: { ...DEFAULT_PROJECT_CONFIG, ...(row.config as Partial<ProjectConfig>) },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const projectsAdmin = new Elysia({ prefix: '/_datakit/admin' })
  .get('/projects', async (): Promise<Project[]> => {
    const rows = await db.select().from(projects).orderBy(projects.createdAt);
    return rows.map(toProjectDto);
  })
  .post(
    '/projects',
    async ({ body, set }) => {
      const bodyConfig = (body.config ?? {}) as Partial<ProjectConfig>;
      const config = {
        ...DEFAULT_PROJECT_CONFIG,
        ...bodyConfig,
        // seedSalt 用环境变量的默认值
        seedSalt: bodyConfig.seedSalt ?? process.env['SEED_SALT'] ?? DEFAULT_PROJECT_CONFIG.seedSalt,
      };

      // 冲突检测：slug 保留字/重复
      const existing = await db.select({ slug: projects.slug }).from(projects);
      const conflicts = checkConflicts({
        slug: body.slug,
        paths: [],
        existingSlugs: existing.map((e) => e.slug),
      });
      if (conflicts.length > 0) {
        set.status = 409;
        return {
          error: 'conflict',
          message: conflicts.join('；'),
          details: conflicts.map((message) => ({ message })),
        };
      }

      const [row] = await db
        .insert(projects)
        .values({
          name: body.name,
          slug: body.slug,
          description: body.description,
          config,
        })
        .returning();
      set.status = 201;
      return toProjectDto(row!);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        slug: t.String({ minLength: 1, maxLength: 63 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )
  .get('/projects/:id', async ({ params, set }): Promise<Project | { error: string; message: string }> => {
    const [row] = await db.select().from(projects).where(eq(projects.id, params.id)).limit(1);
    if (!row) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    return toProjectDto(row);
  })
  .patch(
    '/projects/:id',
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, params.id))
        .limit(1);
      if (!existing) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }

      // slug 变更需做冲突检测
      if (body.slug && body.slug !== existing.slug) {
        const others = await db.select({ slug: projects.slug }).from(projects);
        const conflicts = checkConflicts({
          slug: body.slug,
          paths: [],
          existingSlugs: others.filter((o) => o.slug !== existing.slug).map((o) => o.slug),
        });
        if (conflicts.length > 0) {
          set.status = 409;
          return { error: 'conflict', message: conflicts.join('；') };
        }
      }

      const mergedConfig = {
        ...DEFAULT_PROJECT_CONFIG,
        ...(existing.config as Partial<ProjectConfig>),
        ...(body.config ?? {}),
      };

      const [row] = await db
        .update(projects)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          config: mergedConfig,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, params.id))
        .returning();

      // slug 变了：旧 registry 失效
      if (body.slug && body.slug !== existing.slug) {
        dropProject(existing.slug);
      } else if (body.config) {
        // 盐值变更同步到内存 registry（不重建路由表）
        updateProjectConfig(existing.slug, mergedConfig);
      }
      return toProjectDto(row!);
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        slug: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )
  .delete('/projects/:id', async ({ params, set }) => {
    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, params.id))
      .limit(1);
    if (!existing) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    // 依赖 schema 的 onDelete: cascade（specs/routes/entities/rules/logs 全部级联）
    await db.delete(projects).where(eq(projects.id, params.id));
    dropProject(existing.slug);
    return { ok: true };
  });

export type ProjectsAdmin = typeof projectsAdmin;

// 供 specs 路由复用的查询
export async function getProjectRow(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

// CreateProjectRequest 类型引用（DTO 契约在 shared）
export type { CreateProjectRequest };
