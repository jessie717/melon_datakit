/**
 * 状态化实体存储 —— 通用 JSONB 文档表，不为每个 spec 建表（FR-05.4）。
 *
 * 主键三元组：(project_id, resource_type, resource_key)。
 * 惰性播种：某 resource_type 首次访问时按 schema 生成种子数据。
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { generateFromSchema, operationSeed, type MockValueOptions } from '@datakit/core';
import type { JsonSchema, ProjectConfig } from '@datakit/shared';
import { db } from '../db/client';
import { entities } from '../db/schema';

export interface EntityRow {
  id: string;
  resourceKey: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(row: typeof entities.$inferSelect): EntityRow {
  return {
    id: row.id,
    resourceKey: row.resourceKey,
    data: row.data as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listEntities(
  projectId: string,
  resourceType: string
): Promise<EntityRow[]> {
  const rows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.projectId, projectId), eq(entities.resourceType, resourceType)))
    .orderBy(asc(entities.createdAt));
  return rows.map(toRow);
}

export async function findEntity(
  projectId: string,
  resourceType: string,
  resourceKey: string
): Promise<EntityRow | null> {
  const [row] = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.resourceType, resourceType),
        eq(entities.resourceKey, resourceKey)
      )
    )
    .limit(1);
  return row ? toRow(row) : null;
}

export async function createEntity(
  projectId: string,
  resourceType: string,
  resourceKey: string,
  data: Record<string, unknown>
): Promise<EntityRow> {
  const [row] = await db
    .insert(entities)
    .values({ projectId, resourceType, resourceKey, data })
    .onConflictDoNothing()
    .returning();
  if (row) return toRow(row);
  // 冲突（并发播种/重复 key）→ 更新为新数据
  return (await updateEntity(projectId, resourceType, resourceKey, data))!;
}

export async function updateEntity(
  projectId: string,
  resourceType: string,
  resourceKey: string,
  data: Record<string, unknown>
): Promise<EntityRow | null> {
  const [row] = await db
    .update(entities)
    .set({ data, updatedAt: new Date() })
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.resourceType, resourceType),
        eq(entities.resourceKey, resourceKey)
      )
    )
    .returning();
  return row ? toRow(row) : null;
}

export async function deleteEntity(
  projectId: string,
  resourceType: string,
  resourceKey: string
): Promise<boolean> {
  const rows = await db
    .delete(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.resourceType, resourceType),
        eq(entities.resourceKey, resourceKey)
      )
    )
    .returning({ id: entities.id });
  return rows.length > 0;
}

export async function countEntities(projectId: string, resourceType: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(entities)
    .where(and(eq(entities.projectId, projectId), eq(entities.resourceType, resourceType)));
  return row?.n ?? 0;
}

/** 重置：删掉实体（可按 resource_type），下次访问惰性重播种 → 回到种子态 */
export async function resetEntities(projectId: string, resourceType?: string): Promise<number> {
  const rows = resourceType
    ? await db
        .delete(entities)
        .where(and(eq(entities.projectId, projectId), eq(entities.resourceType, resourceType)))
        .returning({ id: entities.id })
    : await db
        .delete(entities)
        .where(eq(entities.projectId, projectId))
        .returning({ id: entities.id });
  return rows.length;
}

export async function listResourceTypes(projectId: string): Promise<Array<{ resourceType: string; count: number }>> {
  const rows = await db
    .select({ type: entities.resourceType, n: count() })
    .from(entities)
    .where(eq(entities.projectId, projectId))
    .groupBy(entities.resourceType);
  return rows.map((r) => ({ resourceType: r.type, count: r.n }));
}

/**
 * 惰性播种（FR-05.5）：resource_type 首次访问时按 item schema 生成 N 条。
 * 种子确定性：同 seedSalt → 重置后回到相同种子态（验收 A-07）。
 */
export async function ensureSeeded(input: {
  projectId: string;
  resourceType: string;
  itemSchema: JsonSchema | undefined;
  config: ProjectConfig;
  idField: string;
  genOptions: Partial<MockValueOptions>;
}): Promise<void> {
  const existing = await countEntities(input.projectId, input.resourceType);
  if (existing > 0 || !input.itemSchema) return;

  const count_ = input.config.seedEntitiesCount ?? 10;
  for (let i = 0; i < count_; i++) {
    const opSeed = operationSeed({
      projectSalt: input.config.seedSalt,
      operationKey: `seed ${input.resourceType}`,
      fingerprint: `item#${i}`,
      scenario: 'seed',
    });
    const data = generateFromSchema(input.itemSchema, {
      opSeed,
      locale: input.config.locale,
      ...input.genOptions,
    }) as Record<string, unknown>;
    if (!data || typeof data !== 'object') continue;

    const key = String(data[input.idField] ?? `seed-${i}`);
    data[input.idField] = key;
    await createEntity(input.projectId, input.resourceType, key, data);
  }
}
