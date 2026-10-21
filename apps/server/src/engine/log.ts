/**
 * 请求日志 —— 记录、脱敏、截断、自动清理（FR-08）。
 *
 * - 敏感头（Authorization/Cookie）脱敏
 * - 请求/响应体入库前截断（8KB），防止日志表膨胀
 * - 流式响应只记元数据（响应体不落库）
 * - 按项目配置的保留天数自动清理
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { projects, requestLogs } from '../db/schema';
import { publish, type LogBroadcast } from './logbus';

const MAX_BODY_CHARS = 8192;
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

export interface LogInput {
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
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

function truncate(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  try {
    const s = JSON.stringify(value);
    if (s.length <= MAX_BODY_CHARS) return value;
    return { truncated: true, preview: s.slice(0, MAX_BODY_CHARS) };
  } catch {
    return { truncated: true, preview: String(value).slice(0, MAX_BODY_CHARS) };
  }
}

/** 异步落库 + 广播（不阻塞响应） */
export function recordLog(input: LogInput): void {
  void (async () => {
    try {
      const [row] = await db
        .insert(requestLogs)
        .values({
          projectId: input.projectId,
          method: input.method,
          path: input.path,
          query: input.query,
          headers: redactHeaders(input.headers),
          requestBody: truncate(input.requestBody) as Record<string, unknown> | null,
          status: input.status,
          responseBody: truncate(input.responseBody) as Record<string, unknown> | null,
          latencyMs: input.latencyMs,
          matchedRouteId: input.matchedRouteId ?? null,
          error: input.error ?? null,
          seed: input.seed ?? null,
        })
        .returning({ id: requestLogs.id, createdAt: requestLogs.createdAt });

      if (row) {
        const broadcast: LogBroadcast = {
          id: row.id,
          projectId: input.projectId,
          method: input.method,
          path: input.path,
          status: input.status,
          latencyMs: input.latencyMs,
          ...(input.seed != null ? { seed: input.seed } : {}),
          ...(input.error ? { error: input.error } : {}),
          createdAt: row.createdAt.toISOString(),
        };
        publish(input.projectId, broadcast);
      }
    } catch (err) {
      console.warn('[datakit] 请求日志落库失败：', String(err).slice(0, 200));
    }
  })();
}

/** 清理过期日志（按每个项目的保留天数） */
export async function cleanupLogs(): Promise<number> {
  let total = 0;
  const rows = await db
    .select({ id: projects.id, config: projects.config })
    .from(projects)
    .where(sql`${projects.config} ->> 'logRetentionDays' IS NOT NULL`);

  for (const p of rows) {
    const days = Number((p.config as { logRetentionDays?: number })?.logRetentionDays ?? 7);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const deleted = await db
      .delete(requestLogs)
      .where(and(eq(requestLogs.projectId, p.id), lt(requestLogs.createdAt, cutoff)))
      .returning({ id: requestLogs.id });
    total += deleted.length;
  }
  // 没配 retention 的项目按 7 天兜底
  const fallbackCutoff = new Date(Date.now() - 7 * 86_400_000);
  const orphans = await db
    .delete(requestLogs)
    .where(
      and(
        lt(requestLogs.createdAt, fallbackCutoff),
        notInProjects(rows.map((r) => r.id))
      )
    )
    .returning({ id: requestLogs.id })
    .catch(() => []);
  total += orphans.length;

  if (total > 0) console.log(`[datakit] 日志清理：删除 ${total} 条过期记录`);
  return total;
}

function notInProjects(ids: string[]) {
  return ids.length > 0
    ? sql`${requestLogs.projectId} NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
    : sql`true`;
}

/** 启动时清一次 + 每小时一次 */
export function startLogCleanup(): void {
  void cleanupLogs();
  setInterval(() => void cleanupLogs(), 3600_000);
}
