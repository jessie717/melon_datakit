/**
 * Mock 规则内存缓存 —— dispatcher 每请求读取，规则写入后即刻生效。
 * 键：projectId + ' ' + METHOD + ' ' + 路径模板（spec 升级时规则以此存活）
 */
import type { HttpMethod, MockRule } from '@datakit/shared';

const byProject = new Map<string, Map<string, MockRule>>();

function ruleKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function rebuildRules(projectId: string, rules: MockRule[]): void {
  const map = new Map<string, MockRule>();
  for (const r of rules) map.set(ruleKey(r.method, r.path), r);
  byProject.set(projectId, map);
}

export function getRule(
  projectId: string,
  method: string,
  pathTemplate: string
): MockRule | undefined {
  return byProject.get(projectId)?.get(ruleKey(method, pathTemplate));
}

export function upsertRule(projectId: string, rule: MockRule): void {
  const map = byProject.get(projectId) ?? new Map<string, MockRule>();
  map.set(ruleKey(rule.method, rule.path), rule);
  byProject.set(projectId, map);
}

export function deleteRule(projectId: string, ruleId: string): void {
  const map = byProject.get(projectId);
  if (!map) return;
  for (const [key, rule] of map) {
    if (rule.id === ruleId) {
      map.delete(key);
      return;
    }
  }
}

export function dropRules(projectId: string): void {
  byProject.delete(projectId);
}

/** 供 dispatcher 的规则视图（method 用模板路径） */
export function resolveRule(
  projectId: string,
  method: HttpMethod | string,
  pathTemplate: string
): MockRule | undefined {
  return getRule(projectId, method, pathTemplate);
}
