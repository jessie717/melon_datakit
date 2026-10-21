/**
 * 管理 API —— Mock 规则 CRUD（/_datakit/admin/projects/:id/rules）。
 *
 * 规则以 (method, pathTemplate) 为唯一键 —— spec 升级时不随 schema 变更删除（FR-01.9）。
 */
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import type { FieldOverride, MockRule, ValidationMode } from '@datakit/shared';
import { db } from '../db/client';
import { mockRules } from '../db/schema';
import { deleteRule, rebuildRules, upsertRule } from '../engine/rules';
import { getProjectRow } from './projects';

type RuleRow = typeof mockRules.$inferSelect;

export function toRuleDto(row: RuleRow): MockRule {
  return {
    id: row.id,
    projectId: row.projectId,
    method: row.method as MockRule['method'],
    path: row.path,
    enabled: row.enabled,
    ...(row.latencyMs != null ? { latencyMs: row.latencyMs } : {}),
    ...(row.errorRate != null ? { errorRate: row.errorRate } : {}),
    ...(row.errorStatus != null ? { errorStatus: row.errorStatus } : {}),
    ...(row.errorBody != null ? { errorBody: row.errorBody } : {}),
    ...(row.statusOverride != null ? { statusOverride: row.statusOverride } : {}),
    ...(row.bodyStatic != null ? { bodyStatic: row.bodyStatic } : {}),
    ...(row.bodyPatch != null ? { bodyPatch: row.bodyPatch as Record<string, unknown> } : {}),
    fieldOverrides: (row.fieldOverrides as unknown as FieldOverride[]) ?? [],
    ...(row.seed != null ? { seed: row.seed } : {}),
    ...(row.validationMode ? { validationMode: row.validationMode as ValidationMode } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

const ruleBodySchema = t.Object({
  method: t.String({ minLength: 1, maxLength: 10 }),
  path: t.String({ minLength: 1 }),
  enabled: t.Optional(t.Boolean()),
  latencyMs: t.Optional(t.Nullable(t.Integer({ minimum: 0, maximum: 60_000 }))),
  errorRate: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1 }))),
  errorStatus: t.Optional(t.Nullable(t.Integer({ minimum: 100, maximum: 599 }))),
  errorBody: t.Optional(t.Nullable(t.Unknown())),
  statusOverride: t.Optional(t.Nullable(t.Integer({ minimum: 100, maximum: 599 }))),
  bodyStatic: t.Optional(t.Nullable(t.Unknown())),
  bodyPatch: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
  fieldOverrides: t.Optional(t.Array(t.Record(t.String(), t.Unknown()))),
  seed: t.Optional(t.Nullable(t.Integer())),
  validationMode: t.Optional(t.Nullable(t.Union([t.Literal('strict'), t.Literal('lenient'), t.Literal('off')]))),
  note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
});

export const rulesAdmin = new Elysia({ prefix: '/_datakit/admin' })
  .get('/projects/:id/rules', async ({ params, set }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    const rows = await db.select().from(mockRules).where(eq(mockRules.projectId, params.id));
    return rows.map(toRuleDto);
  })
  // upsert：同一 (method, path) 只有一条规则
  .put(
    '/projects/:id/rules',
    async ({ params, body, set }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const existing = await db
        .select()
        .from(mockRules)
        .where(
          and(
            eq(mockRules.projectId, params.id),
            eq(mockRules.method, body.method.toUpperCase()),
            eq(mockRules.path, body.path)
          )
        )
        .limit(1);

      const values = {
        enabled: body.enabled ?? true,
        latencyMs: body.latencyMs ?? null,
        errorRate: body.errorRate ?? null,
        errorStatus: body.errorStatus ?? null,
        errorBody: body.errorBody ?? null,
        statusOverride: body.statusOverride ?? null,
        bodyStatic: body.bodyStatic ?? null,
        bodyPatch: body.bodyPatch ?? null,
        fieldOverrides: (body.fieldOverrides as unknown[]) ?? [],
        seed: body.seed ?? null,
        validationMode: body.validationMode ?? null,
        note: body.note ?? null,
        updatedAt: new Date(),
      };

      const [row] = existing[0]
        ? await db
            .update(mockRules)
            .set(values)
            .where(eq(mockRules.id, existing[0].id))
            .returning()
        : await db
            .insert(mockRules)
            .values({
              projectId: params.id,
              method: body.method.toUpperCase(),
              path: body.path,
              ...values,
            })
            .returning();

      upsertRule(params.id, toRuleDto(row!));
      return toRuleDto(row!);
    },
    { body: ruleBodySchema }
  )
  .delete('/projects/:id/rules/:ruleId', async ({ params, set }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    const [row] = await db
      .select()
      .from(mockRules)
      .where(and(eq(mockRules.projectId, params.id), eq(mockRules.id, params.ruleId)))
      .limit(1);
    if (!row) {
      set.status = 404;
      return { error: 'not_found', message: `规则 ${params.ruleId} 不存在` };
    }
    await db.delete(mockRules).where(eq(mockRules.id, params.ruleId));
    deleteRule(params.id, params.ruleId);
    return { ok: true };
  });

/** 启动预热：加载所有项目的规则进内存 */
export async function bootstrapRules(): Promise<void> {
  const rows = await db.select().from(mockRules);
  const grouped = new Map<string, MockRule[]>();
  for (const row of rows) {
    const list = grouped.get(row.projectId) ?? [];
    list.push(toRuleDto(row));
    grouped.set(row.projectId, list);
  }
  for (const [projectId, rules] of grouped) rebuildRules(projectId, rules);
  if (grouped.size > 0) {
    console.log(`[datakit] 规则预热完成：${rows.length} 条规则`);
  }
}

export type RulesAdmin = typeof rulesAdmin;
