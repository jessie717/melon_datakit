import { describe, expect, test } from 'bun:test';
import { assembleResponse } from './assemble';
import { fieldNameOf, generateFromSchema } from './generate';

const PET_SCHEMA = {
  type: 'object',
  required: ['id', 'name', 'email'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string' },
    price: { type: 'number' },
    age: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    owner: {
      type: 'object',
      required: ['name', 'address'],
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        company: { type: 'string' },
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
    secret: { type: 'string' },
  },
};

describe('generateFromSchema — 确定性', () => {
  test('同 seed 同结果（字节级）', () => {
    const a = generateFromSchema(PET_SCHEMA, { opSeed: 12345, locale: 'zh_CN' });
    const b = generateFromSchema(PET_SCHEMA, { opSeed: 12345, locale: 'zh_CN' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('不同 seed 结果不同', () => {
    const a = generateFromSchema(PET_SCHEMA, { opSeed: 1, locale: 'zh_CN' });
    const b = generateFromSchema(PET_SCHEMA, { opSeed: 2, locale: 'zh_CN' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test('字段级 seed：兄弟字段不漂移（增删字段不影响他人）', () => {
    const withExtra = {
      ...PET_SCHEMA,
      properties: {
        ...PET_SCHEMA.properties,
        nickname: { type: 'string' }, // 新增字段
      },
    };
    const a = generateFromSchema(PET_SCHEMA, { opSeed: 42, locale: 'zh_CN' }) as Record<string, unknown>;
    const b = generateFromSchema(withExtra, { opSeed: 42, locale: 'zh_CN' }) as Record<string, unknown>;
    // 已有字段的值保持一致（nickname 可能出现/不出现，不影响兄弟）
    expect(a['email']).toBe(b['email']);
    expect(a['price']).toBe(b['price']);
    expect(a['phone'] === b['phone'] || a['phone'] === undefined || b['phone'] === undefined).toBe(true);
    // owner 子树也不受影响
    expect(a['owner']).toEqual(b['owner']);
  });
});

describe('generateFromSchema — 中文与启发式', () => {
  test('姓名/地址/公司走中文', () => {
    const v = generateFromSchema(PET_SCHEMA, { opSeed: 7, locale: 'zh_CN' }) as Record<string, unknown>;
    const owner = v['owner'] as Record<string, unknown>;
    expect(typeof owner['name']).toBe('string');
    expect(typeof owner['address']).toBe('string');
    // 中文启发式输出应含 CJK 字符（姓名/地址）
    expect(/[一-鿿]/.test(String(owner['name']) + String(owner['address']))).toBe(true);
  });

  test('email/uuid/time 启发式', () => {
    // 全部字段 required —— 避免可选出现干扰启发式断言
    const schema = {
      type: 'object',
      required: ['id', 'email', 'createdAt', 'age', 'price', 'phone'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        createdAt: { type: 'string', format: 'date-time' },
        age: { type: 'integer' },
        price: { type: 'number' },
        phone: { type: 'string' },
      },
    };
    const v = generateFromSchema(schema, { opSeed: 7, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(String(v['email'])).toContain('@');
    expect(String(v['id'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(v['createdAt'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof v['age']).toBe('number');
    expect(typeof v['price']).toBe('number');
    expect(String(v['phone']).length).toBeGreaterThan(0);
  });

  test('required 字段必出现', () => {
    for (let seed = 0; seed < 20; seed++) {
      const v = generateFromSchema(PET_SCHEMA, { opSeed: seed, locale: 'zh_CN' }) as Record<string, unknown>;
      expect(v['id']).toBeDefined();
      expect(v['name']).toBeDefined();
      expect(v['email']).toBeDefined();
    }
  });
});

describe('generateFromSchema — enum/const/约束', () => {
  test('enum 确定性取值', () => {
    const schema = { type: 'object', properties: { status: { type: 'string', enum: ['a', 'b', 'c'] } }, required: ['status'] };
    const v = generateFromSchema(schema, { opSeed: 3, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(['a', 'b', 'c']).toContain(String(v['status']));
    const again = generateFromSchema(schema, { opSeed: 3, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(String(v['status'])).toBe(String(again['status']));
  });

  test('const 优先', () => {
    const schema = { type: 'object', properties: { kind: { const: 'pet' } }, required: ['kind'] };
    const v = generateFromSchema(schema, { opSeed: 1, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(v['kind']).toBe('pet');
  });

  test('min/max 约束被遵守', () => {
    const schema = {
      type: 'object',
      required: ['n'],
      properties: { n: { type: 'integer', minimum: 5, maximum: 5 } },
    };
    const v = generateFromSchema(schema, { opSeed: 9, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(v['n']).toBe(5);
  });

  test('minItems/maxItems 约束', () => {
    const schema = {
      type: 'object',
      required: ['list'],
      properties: { list: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } } },
    };
    const v = generateFromSchema(schema, { opSeed: 11, locale: 'zh_CN' }) as Record<string, unknown>;
    expect((v['list'] as unknown[]).length).toBe(2);
  });

  test('allOf 合并生成', () => {
    const schema = {
      allOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
        { type: 'object', required: ['b'], properties: { b: { type: 'integer' } } },
      ],
    };
    const v = generateFromSchema(schema, { opSeed: 5, locale: 'zh_CN' }) as Record<string, unknown>;
    expect(v['a']).toBeDefined();
    expect(v['b']).toBeDefined();
  });

  test('循环引用不崩（深度上限）', () => {
    const node: Record<string, unknown> = { type: 'object', properties: {} };
    (node['properties'] as Record<string, unknown>)['next'] = node;
    expect(() => generateFromSchema(node, { opSeed: 1, locale: 'zh_CN' })).not.toThrow();
  });
});

describe('字段覆盖', () => {
  test('literal 覆盖', () => {
    const v = generateFromSchema(PET_SCHEMA, {
      opSeed: 10,
      locale: 'zh_CN',
      fieldOverrides: [{ path: 'name', generator: { kind: 'literal', value: '张三' } }],
    }) as Record<string, unknown>;
    expect(v['name']).toBe('张三');
  });

  test('increment 生成器', () => {
    const v = generateFromSchema(
      { type: 'object', required: ['a', 'b'], properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
      {
        opSeed: 10,
        locale: 'zh_CN',
        fieldOverrides: [
          { path: 'a', generator: { kind: 'increment', start: 100, step: 5 } },
          { path: 'b', generator: { kind: 'increment', start: 100, step: 5 } },
        ],
      }
    ) as Record<string, unknown>;
    expect(v['a']).toBe(100);
    expect(v['b']).toBe(105);
  });

  test('嵌套路径覆盖', () => {
    const v = generateFromSchema(PET_SCHEMA, {
      opSeed: 10,
      locale: 'zh_CN',
      fieldOverrides: [{ path: 'owner.company', generator: { kind: 'literal', value: 'ACME' } }],
    }) as Record<string, unknown>;
    expect((v['owner'] as Record<string, unknown>)['company']).toBe('ACME');
  });
});

describe('assembleResponse — 优先级链', () => {
  test('example 优先于生成', () => {
    const example = { id: 'fixed-id', name: '示例名' };
    const v = assembleResponse(PET_SCHEMA, { opSeed: 1, locale: 'zh_CN', example }) as Record<string, unknown>;
    expect(v['id']).toBe('fixed-id');
    expect(v['name']).toBe('示例名');
  });

  test('字段覆盖 > example', () => {
    const v = assembleResponse(PET_SCHEMA, {
      opSeed: 1,
      locale: 'zh_CN',
      example: { id: 'fixed-id', name: '示例名' },
      fieldOverrides: [{ path: 'name', generator: { kind: 'literal', value: '覆盖名' } }],
    }) as Record<string, unknown>;
    expect(v['name']).toBe('覆盖名');
    expect(v['id']).toBe('fixed-id'); // 其余保留 example
  });

  test('bodyPatch > 字段覆盖', () => {
    const v = assembleResponse(PET_SCHEMA, {
      opSeed: 1,
      locale: 'zh_CN',
      fieldOverrides: [{ path: 'name', generator: { kind: 'literal', value: '字段覆盖' } }],
      bodyPatch: { name: 'patch 名' },
    }) as Record<string, unknown>;
    expect(v['name']).toBe('patch 名');
  });

  test('bodyStatic 最高优先级', () => {
    const v = assembleResponse(PET_SCHEMA, {
      opSeed: 1,
      locale: 'zh_CN',
      bodyStatic: { hello: 'world' },
      bodyPatch: { name: 'x' },
      example: { id: 'y' },
    });
    expect(v).toEqual({ hello: 'world' });
  });
});

describe('fieldNameOf', () => {
  test('从路径取字段名', () => {
    expect(fieldNameOf('user.name')).toBe('name');
    expect(fieldNameOf('items[0].price')).toBe('price');
    expect(fieldNameOf('name')).toBe('name');
    expect(fieldNameOf('')).toBe('');
  });
});
