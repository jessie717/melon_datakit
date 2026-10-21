/**
 * Spec 文本解析 —— JSON/YAML → dereference 后的文档对象。
 * 支持 Swagger 2.0 / OpenAPI 3.0 / 3.1（@readme/openapi-parser）。
 */
import { dereference, validate } from '@readme/openapi-parser';
import { parse as parseYaml } from 'yaml';

export interface ParseSpecResult {
  /** dereference 后的文档（$ref 已内联，含循环引用标记） */
  spec: Record<string, unknown>;
  openapiVersion: string;
  warnings: string[];
}

export class SpecParseError extends Error {
  constructor(
    message: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = 'SpecParseError';
  }
}

/** 解析 spec 文本（JSON 或 YAML 自动识别）并做 dereference */
export async function parseSpecText(text: string): Promise<ParseSpecResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new SpecParseError('spec 内容为空');

  let raw: unknown;
  try {
    raw = trimmed.startsWith('{') || trimmed.startsWith('[')
      ? JSON.parse(text)
      : parseYaml(text);
  } catch (err) {
    throw new SpecParseError(
      `spec 文本解析失败（${trimmed.startsWith('{') ? 'JSON' : 'YAML'} 格式错误）`,
      [String(err)]
    );
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SpecParseError('spec 根节点必须是对象');
  }

  const doc = raw as Record<string, unknown>;
  const openapiVersion = String(doc['swagger'] ?? doc['openapi'] ?? '');
  if (!openapiVersion) {
    throw new SpecParseError(
      '不是有效的 OpenAPI/Swagger 文档（缺少 swagger/openapi 版本字段）'
    );
  }

  // dereference：$ref 内联（含外部引用与循环引用）
  let dereferenced: unknown;
  try {
    dereferenced = await dereference(doc as never);
  } catch (err) {
    throw new SpecParseError('spec dereference 失败', [String(err)]);
  }

  return {
    spec: dereferenced as Record<string, unknown>,
    openapiVersion,
    warnings: [],
  };
}

/** 尝试校验 spec 合法性（失败不阻断导入，只产生警告） */
export async function validateSpecText(text: string): Promise<string[]> {
  try {
    const trimmed = text.trim();
    const raw = trimmed.startsWith('{') || trimmed.startsWith('[')
      ? JSON.parse(text)
      : parseYaml(text);
    await validate(raw as never);
    return [];
  } catch (err) {
    return [`spec 校验告警：${String(err)}`];
  }
}
