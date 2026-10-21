/**
 * 导入期冲突检测（FR-01.7）。
 *
 * 两层检查：
 * 1. 项目 slug：格式合法、不撞保留词、不撞其他项目 mountPath
 * 2. spec 路径模板：不撞系统保留前缀（/_datakit/**）、不出现 /p/ 嵌套歧义
 */

/** 系统保留前缀 —— mock 流量永远进不来这里 */
export const RESERVED_PREFIX = '/_datakit';

/** mock 流量挂载前缀 */
export const MOCK_PREFIX = '/p';

/** slug 保留词 */
export const RESERVED_SLUGS = new Set(['_datakit', 'admin', 'api', 'p', 'static', 'public']);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ConflictInput {
  slug: string;
  /** 归一化后的路径模板列表 */
  paths: string[];
  /** 其他项目的 slug（不含自身） */
  existingSlugs: string[];
}

/** 返回冲突原因列表；空数组 = 无冲突 */
export function checkConflicts(input: ConflictInput): string[] {
  const errors: string[] = [];

  // —— slug 检查 ——
  if (!SLUG_RE.test(input.slug)) {
    errors.push(
      `项目标识 "${input.slug}" 非法：只能用小写字母/数字/连字符，以字母或数字开头，最长 63 字符`
    );
  } else if (RESERVED_SLUGS.has(input.slug)) {
    errors.push(`项目标识 "${input.slug}" 是系统保留字，请换一个`);
  }

  if (input.existingSlugs.includes(input.slug)) {
    errors.push(`项目标识 "${input.slug}" 已被其他项目占用（mountPath 冲突）`);
  }

  // —— spec 路径检查 ——
  for (const path of input.paths) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (normalized === RESERVED_PREFIX || normalized.startsWith(`${RESERVED_PREFIX}/`)) {
      errors.push(
        `路径 "${path}" 撞上系统保留前缀 ${RESERVED_PREFIX}/**，请调整 spec 或使用项目挂载前缀隔离`
      );
    }
    if (normalized === MOCK_PREFIX || normalized.startsWith(`${MOCK_PREFIX}/`)) {
      errors.push(
        `路径 "${path}" 以 ${MOCK_PREFIX}/ 开头，会与多项目挂载前缀产生歧义，请调整 spec`
      );
    }
  }

  return errors;
}
