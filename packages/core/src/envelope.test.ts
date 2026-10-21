import { describe, expect, test } from 'bun:test';
import { buildListResponse, filterEntities, itemSchemaOf, parsePagination } from './envelope';
import { getByPath, setByPath } from './json-path';

describe('parsePagination', () => {
  test('limit + offset', () => {
    const p = parsePagination({ limit: '20', offset: '40' });
    expect(p.limit).toBe(20);
    expect(p.offset).toBe(40);
    expect(p.pageKeys.sort()).toEqual(['limit', 'offset']);
  });

  test('page + pageSize → offset', () => {
    const p = parsePagination({ page: '3', pageSize: '10' });
    expect(p.limit).toBe(10);
    expect(p.offset).toBe(20);
  });

  test('size / perPage 变体', () => {
    expect(parsePagination({ size: '5' }).limit).toBe(5);
    expect(parsePagination({ perPage: '5' }).limit).toBe(5);
  });

  test('无分页参数', () => {
    const p = parsePagination({ status: 'ok' });
    expect(p.limit).toBeUndefined();
    expect(p.offset).toBe(0);
  });

  test('非法数字忽略', () => {
    const p = parsePagination({ limit: 'abc' });
    expect(p.limit).toBeUndefined();
  });
});

describe('itemSchemaOf', () => {
  const schema = {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
          total: { type: 'integer' },
        },
      },
    },
  };

  test('信封路径 data.items', () => {
    const item = itemSchemaOf(schema as never, 'data.items');
    expect(item).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
  });

  test('顶层数组（信封空串）', () => {
    const arr = { type: 'array', items: { type: 'object', properties: { a: {} } } };
    expect(itemSchemaOf(arr as never, '')).toMatchObject({ type: 'object' });
  });

  test('路径不存在 → undefined', () => {
    expect(itemSchemaOf(schema as never, 'x.y')).toBeUndefined();
  });
});

describe('buildListResponse', () => {
  test('信封空串直接返回数组', () => {
    expect(buildListResponse({ ignored: true }, '', [1, 2])).toEqual([1, 2]);
  });

  test('填 items 并同步 total', () => {
    const base = { data: { items: [{ id: 'x' }], total: 999, code: 0 } };
    const out = buildListResponse(base, 'data.items', [{ id: 'a' }, { id: 'b' }]) as Record<string, never>;
    const data = getByPath(out, 'data') as { items: unknown[]; total: number; code: number };
    expect(data.items).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.code).toBe(0); // 其它字段不动
  });

  test('分页场景 totalCount = 过滤后总数（≠ items.length）', () => {
    const base = { data: { items: [], total: 0 } };
    const out = buildListResponse(base, 'data.items', [{ id: 'a' }, { id: 'b' }], 57) as Record<string, never>;
    expect(getByPath(out, 'data.total')).toBe(57);
  });

  test('items 是唯一计数同名键时不自指', () => {
    const base = { rows: [{ id: 'x' }] };
    const out = buildListResponse(base, 'rows', [{ id: 'a' }]) as Record<string, unknown>;
    expect((out['rows'] as unknown[]).length).toBe(1);
    // rows 自身是数组，不生成 rows.rows
    expect(out['rows.rows']).toBeUndefined();
  });
});

describe('filterEntities', () => {
  const entities = [
    { data: { id: '1', status: 'ok', name: '甲' } },
    { data: { id: '2', status: 'fail', name: '乙' } },
    { data: { id: '3', status: 'ok', name: '丙' } },
  ];

  test('等值过滤', () => {
    const out = filterEntities(entities, { status: 'ok' }, []);
    expect(out.map((e) => e.data['id'])).toEqual(['1', '3']);
  });

  test('分页键不参与过滤', () => {
    const out = filterEntities(entities, { status: 'ok', limit: '2' }, ['limit']);
    expect(out).toHaveLength(2);
  });

  test('无过滤返回全部', () => {
    expect(filterEntities(entities, {}, [])).toHaveLength(3);
  });
});

describe('json-path', () => {
  test('get/set 嵌套与数组', () => {
    const v = setByPath({}, 'a.b[0].c', 42);
    expect(getByPath(v, 'a.b[0].c')).toBe(42);
    expect(getByPath(v, 'a.missing')).toBeUndefined();
  });
});
