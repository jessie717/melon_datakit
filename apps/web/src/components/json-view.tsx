/**
 * 轻量 JSON/Schema 渲染 —— 等宽字 + 语法着色，只读。
 * 不引入 Monaco/CodeMirror（过重），用递归渲染紧凑树。
 */

type Json = unknown;

const TYPE_COLORS: Record<string, string> = {
  string: 'var(--color-get)',
  number: 'var(--color-post)',
  integer: 'var(--color-post)',
  boolean: 'var(--color-put)',
  null: 'var(--color-ink-3)',
  array: 'var(--color-post)',
  object: 'var(--color-ink-2)',
};

function renderValue(value: Json, indent: number, key?: string): React.ReactNode {
  const pad = { paddingLeft: indent * 12 };

  if (value === null) {
    return (
      <div style={pad} className="mono text-[12px] leading-6">
        {key !== undefined && <span className="text-ink-2">{key}: </span>}
        <span style={{ color: TYPE_COLORS['null'] }}>null</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div style={pad}>
        <div className="mono text-[12px] leading-6">
          {key !== undefined && <span className="text-ink-2">{key}: </span>}
          <span style={{ color: TYPE_COLORS['array'] }}>[</span>
        </div>
        {value.map((v, i) => (
          <div key={i}>{renderValue(v, indent + 1)}</div>
        ))}
        <div className="mono text-[12px] leading-6" style={{ paddingLeft: indent * 12 }}>
          <span style={{ color: TYPE_COLORS['array'] }}>]</span>
        </div>
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, Json>);
    return (
      <div style={pad}>
        <div className="mono text-[12px] leading-6">
          {key !== undefined && <span className="text-ink-2">{key}: </span>}
          <span style={{ color: TYPE_COLORS['object'] }}>{'{'}</span>
        </div>
        {entries.map(([k, v]) => (
          <div key={k}>{renderValue(v, indent + 1, k)}</div>
        ))}
        <div className="mono text-[12px] leading-6" style={{ paddingLeft: indent * 12 }}>
          <span style={{ color: TYPE_COLORS['object'] }}>{'}'}</span>
        </div>
      </div>
    );
  }

  const primitive = typeof value;
  // 朱红（签名色）只留给印章/状态，JSON 值用数据青/靛区分
  const color =
    primitive === 'string'
      ? 'var(--color-get)'
      : TYPE_COLORS[primitive] ?? 'var(--color-ink)';
  const display = primitive === 'string' ? `"${value}"` : String(value);

  return (
    <div style={pad} className="mono text-[12px] leading-6">
      {key !== undefined && <span className="text-ink-2">{key}: </span>}
      <span style={{ color }}>{display}</span>
    </div>
  );
}

export function JsonView({ value, maxHeight = 320 }: { value: Json; maxHeight?: number }) {
  if (value === undefined) {
    return <p className="text-ink-3 text-[12px]">无</p>;
  }
  return (
    <div
      className="overflow-auto rounded-xs border border-rule bg-code-bg p-3"
      style={{ maxHeight }}
    >
      {renderValue(value, 0)}
    </div>
  );
}

/** Schema 摘要行：type / format / required 一眼可见 */
export function SchemaBadge({ schema }: { schema: Record<string, unknown> }) {
  const type = Array.isArray(schema['type'])
    ? (schema['type'] as string[]).join(' | ')
    : (schema['type'] as string | undefined) ?? 'any';
  const format = schema['format'] as string | undefined;
  return (
    <span className="mono text-[11px] text-ink-3">
      {type}
      {format ? ` · ${format}` : ''}
    </span>
  );
}
