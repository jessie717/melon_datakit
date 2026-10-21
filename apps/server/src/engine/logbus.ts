/**
 * 日志总线 —— 请求日志的实时推送（SSE 订阅源）。
 */
export interface LogBroadcast {
  id: string;
  projectId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  seed?: number;
  error?: string;
  createdAt: string;
}

type Listener = (entry: LogBroadcast) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(projectId: string, fn: Listener): () => void {
  const set = listeners.get(projectId) ?? new Set();
  set.add(fn);
  listeners.set(projectId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(projectId);
  };
}

export function publish(projectId: string, entry: LogBroadcast): void {
  const set = listeners.get(projectId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(entry);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  }
}

export function subscriberCount(projectId: string): number {
  return listeners.get(projectId)?.size ?? 0;
}
