/**
 * 管理 API —— Spec 导入（URL 拉取 / 文件上传）与查询。
 *
 * 导入管线：文本 → parse（dereference）→ normalize（RouteModel[]）
 *   → 冲突检测 → 持久化（旧 spec 置无效）→ 重建内存路由表
 *
 * 重导入语义（FR-01.9）：mock 规则与实体不删（各自有独立存活键）；
 * schemaHash 变化的路由产生 warning，提示「请复核规则」。
 */
import { Elysia, t } from 'elysia';
import { and, eq, desc } from 'drizzle-orm';
import {
  parseSpecText,
  normalizeSpec,
  validateSpecText,
  checkConflicts,
  SpecParseError,
} from '@datakit/core';
import type { ImportSpecResponse, RouteModel, SpecRecord } from '@datakit/shared';
import { db } from '../db/client';
import { routes, specs } from '../db/schema';
import { rebuildProject } from '../engine/registry';
import { getProjectRow, toProjectDto } from './projects';

const MAX_SPEC_BYTES = 5 * 1024 * 1024; // 5MB

function toSpecDto(row: typeof specs.$inferSelect): SpecRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType as SpecRecord['sourceType'],
    sourceUri: row.sourceUri,
    openapiVersion: row.openapiVersion,
    checksum: row.checksum,
    isActive: row.isActive,
    importedAt: row.importedAt.toISOString(),
    ...(row.parseError ? { parseError: row.parseError } : {}),
  };
}

async function checksumOf(text: string): Promise<string> {
  const digest = await new Bun.CryptoHasher('sha256').update(text).digest();
  return Buffer.from(digest).toString('hex');
}

/** 导入核心：拿到 spec 文本后的完整管线 */
async function importSpecText(input: {
  projectId: string;
  slug: string;
  sourceType: 'url' | 'file';
  sourceUri: string;
  text: string;
}): Promise<ImportSpecResponse> {
  if (input.text.length > MAX_SPEC_BYTES) {
    throw new SpecParseError(`spec 超过 ${MAX_SPEC_BYTES / 1024 / 1024}MB 上限`);
  }

  // 1. 解析 + dereference
  const { spec, openapiVersion, warnings: parseWarnings } = await parseSpecText(input.text);

  // 2. 校验（非阻断，只产生告警）
  const validationWarnings = await validateSpecText(input.text);

  // 3. 归一化 → RouteModel[]
  const { routes: routeModels, warnings: normalizeWarnings } = normalizeSpec(spec);
  if (routeModels.length === 0) {
    throw new SpecParseError('spec 中没有任何可导入的接口路径');
  }

  // 4. 冲突检测（FR-01.7 / A-13）
  const rawPaths = Object.keys((spec['paths'] ?? {}) as Record<string, unknown>);
  const conflicts = checkConflicts({
    slug: input.slug,
    paths: rawPaths,
    existingSlugs: [], // mountPath 冲突在项目创建时已检测
  });
  if (conflicts.length > 0) {
    throw new SpecParseError(`路径冲突检测未通过：${conflicts.join('；')}`, conflicts);
  }

  // 5. 持久化：旧 spec 置无效，插入新 spec + routes
  const checksum = await checksumOf(input.text);

  // 幂等短路：内容与当前生效 spec 一致 → 不重复入库
  const activeSpecs = await db
    .select()
    .from(specs)
    .where(eq(specs.projectId, input.projectId));
  const sameActive = activeSpecs.find((s) => s.isActive && s.checksum === checksum);
  if (sameActive) {
    const existingRoutes = await db
      .select()
      .from(routes)
      .where(eq(routes.specId, sameActive.id));
    return {
      specId: sameActive.id,
      routeCount: existingRoutes.length,
      openapiVersion: sameActive.openapiVersion,
      warnings: ['spec 内容与当前生效版本一致，未重复导入'],
    };
  }

  // 旧路由的 schemaHash（用于变更检测，只看当前生效 spec）
  const oldRoutes = await db
    .select()
    .from(routes)
    .innerJoin(specs, eq(routes.specId, specs.id))
    .where(and(eq(specs.projectId, input.projectId), eq(specs.isActive, true)));
  const oldHashes = new Map<string, string>(
    oldRoutes.map((r) => [`${r.routes.method} ${r.routes.path}`, r.routes.schemaHash])
  );

  // 持久化必须原子：旧 spec 置无效 + 插入新 spec/routes 任一失败都不能留下
  // 「所有 spec 全部 inactive」的破坏状态
  const specRow = await db.transaction(async (tx) => {
    await tx.update(specs).set({ isActive: false }).where(eq(specs.projectId, input.projectId));

    const [row] = await tx
      .insert(specs)
      .values({
        projectId: input.projectId,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri,
        content: spec as Record<string, unknown>,
        openapiVersion,
        checksum,
        isActive: true,
      })
      .returning();

    if (routeModels.length > 0) {
      await tx.insert(routes).values(
        routeModels.map((r) => ({
          specId: row!.id,
          method: r.method,
          path: r.path,
          operationId: r.operationId ?? null,
          summary: r.summary ?? null,
          tags: r.tags,
          requestSchema: buildRequestSchema(r),
          responseSchema: buildResponseSchema(r),
          successStatus: r.successStatus,
          isStreaming: !!r.streaming,
          streamKind: r.streaming ?? null,
          crud: (r.crud as unknown as Record<string, unknown>) ?? null,
          schemaHash: r.schemaHash,
        }))
      );
    }
    return row!;
  });

  // 6. 重建内存路由表（spec 热更新，不重启进程）
  rebuildProject(input.projectId, input.slug, routeModels);

  // 7. schemaHash 变更告警（FR-01.9：提示复核规则）
  const warnings = [...parseWarnings, ...validationWarnings, ...normalizeWarnings];
  for (const r of routeModels) {
    const oldHash = oldHashes.get(`${r.method} ${r.path}`);
    if (oldHash && oldHash !== r.schemaHash) {
      warnings.push(
        `路由 ${r.method} ${r.path} 的 schema 已变更，请复核该接口的 mock 规则`
      );
    }
  }

  return {
    specId: specRow.id,
    routeCount: routeModels.length,
    openapiVersion,
    warnings,
  };
}

function buildRequestSchema(r: RouteModel): Record<string, unknown> {
  return {
    params: r.params.filter((p) => p.in === 'path'),
    query: r.params.filter((p) => p.in === 'query'),
    headers: r.params.filter((p) => p.in === 'header'),
    ...(r.requestBody ? { body: r.requestBody } : {}),
  };
}

function buildResponseSchema(r: RouteModel): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const res of r.responses) {
    map[String(res.status)] = {
      contentType: res.contentType,
      schema: res.schema,
      ...(res.example !== undefined ? { example: res.example } : {}),
    };
  }
  return map;
}

export const specsAdmin = new Elysia({ prefix: '/_datakit/admin' })
  // URL 导入
  .post(
    '/projects/:id/specs',
    async ({ params, body, set }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }

      try {
        if (body.sourceType === 'url') {
          const res = await fetch(body.sourceUri!, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) {
            set.status = 400;
            return {
              error: 'fetch_failed',
              message: `拉取 spec 失败：HTTP ${res.status} ${res.statusText}`,
            };
          }
          const text = await res.text();
          const result = await importSpecText({
            projectId: project.id,
            slug: project.slug,
            sourceType: 'url',
            sourceUri: body.sourceUri!,
            text,
          });
          set.status = 201;
          return result;
        }

        set.status = 400;
        return {
          error: 'invalid_source_type',
          message: '此端点只接受 sourceType=url；文件上传请用 multipart POST',
        };
      } catch (err) {
        return specErrorToResponse(err, set);
      }
    },
    {
      body: t.Object({
        sourceType: t.Union([t.Literal('url')]),
        sourceUri: t.String({ minLength: 1 }),
      }),
    }
  )
  // 文件上传导入（multipart）
  .post(
    '/projects/:id/specs/file',
    async ({ params, request, set }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }

      try {
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.includes('multipart/form-data')) {
          set.status = 400;
          return {
            error: 'invalid_content_type',
            message: '请以 multipart/form-data 上传文件（字段名 file）',
          };
        }

        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
          set.status = 400;
          return { error: 'missing_file', message: '缺少文件字段 file' };
        }
        const text = await file.text();

        const result = await importSpecText({
          projectId: project.id,
          slug: project.slug,
          sourceType: 'file',
          sourceUri: file.name || 'uploaded',
          text,
        });
        set.status = 201;
        return result;
      } catch (err) {
        return specErrorToResponse(err, set);
      }
    }
  )
  .get(
    '/projects/:id/specs',
    async ({ params, set }) => {
      const project = await getProjectRow(params.id);
      if (!project) {
        set.status = 404;
        return { error: 'not_found', message: `项目 ${params.id} 不存在` };
      }
      const rows = await db
        .select()
        .from(specs)
        .where(eq(specs.projectId, params.id))
        .orderBy(desc(specs.importedAt));
      return rows.map(toSpecDto);
    }
  )
  // 项目详情（含 DTO；供 UI 一次拿全）
  .get('/projects/:id/overview', async ({ params, set }) => {
    const project = await getProjectRow(params.id);
    if (!project) {
      set.status = 404;
      return { error: 'not_found', message: `项目 ${params.id} 不存在` };
    }
    const specRows = await db
      .select()
      .from(specs)
      .where(eq(specs.projectId, params.id))
      .orderBy(desc(specs.importedAt));
    return {
      project: toProjectDto(project),
      specs: specRows.map(toSpecDto),
    };
  });

function specErrorToResponse(
  err: unknown,
  set: { status?: number | string }
): { error: string; message: string; details?: Array<{ message: string }> } {
  if (err instanceof SpecParseError) {
    set.status = 400;
    return {
      error: 'spec_parse_error',
      message: err.message,
      ...(err.details ? { details: err.details.map((message) => ({ message })) } : {}),
    };
  }
  set.status = 500;
  // DB/底层错误可能带完整参数 dump，截断避免刷屏
  const raw = String(err);
  return { error: 'import_failed', message: raw.length > 500 ? `${raw.slice(0, 500)}…` : raw };
}

export type SpecsAdmin = typeof specsAdmin;
