import { beforeAll, describe, expect, test } from 'bun:test';
import { dereference } from '@readme/openapi-parser';
import { normalizeSpec, normalizeSchema } from './normalize';
import type { RouteModel } from '@datakit/shared';

/** 走真实管线：先 dereference（$ref 内联）再 normalize */
async function deref(spec: unknown): Promise<Record<string, unknown>> {
  const clone = JSON.parse(JSON.stringify(spec));
  return (await dereference(clone as never)) as Record<string, unknown>;
}

// ============ OAS 3.0 fixture（petstore 风格） ============

const OAS3_PETSTORE = {
  openapi: '3.0.3',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v2' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: '宠物列表',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        items: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
                example: { data: { items: [], total: 0 } },
              },
            },
          },
          '404': {
            description: 'not found',
            content: {
              'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NewPet' } },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getPet',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        responses: { '204': { description: 'deleted' } },
      },
    },
    '/files/{filepath}': {
      get: {
        operationId: 'downloadFile',
        parameters: [{ name: 'filepath', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'file',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
    '/stream/events': {
      get: {
        operationId: 'streamEvents',
        responses: {
          '200': {
            description: 'sse',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email', nullable: true },
          secret: { type: 'string', writeOnly: true },
          createdAt: { type: 'string', format: 'date-time', readOnly: true },
        },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          secret: { type: 'string', writeOnly: true },
          createdAt: { type: 'string', format: 'date-time', readOnly: true },
        },
      },
    },
  },
};

// ============ Swagger 2.0 fixture ============

const SWAGGER2 = {
  swagger: '2.0',
  info: { title: 'Legacy', version: '1.0' },
  basePath: '/api/v1',
  produces: ['application/json'],
  consumes: ['application/json'],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [{ name: 'page', in: 'query', type: 'integer' }],
        responses: {
          '200': {
            description: 'ok',
            schema: {
              type: 'object',
              properties: { rows: { type: 'array', items: { $ref: '#/definitions/User' } } },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        parameters: [
          { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/User' } },
        ],
        responses: { '201': { description: 'created', schema: { $ref: '#/definitions/User' } } },
      },
    },
    '/upload': {
      post: {
        operationId: 'uploadFile',
        consumes: ['multipart/form-data'],
        parameters: [
          { name: 'file', in: 'formData', required: true, type: 'file' },
          { name: 'note', in: 'formData', type: 'string' },
        ],
        responses: { '200': { description: 'ok', schema: { type: 'object' } } },
      },
    },
  },
  definitions: {
    User: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
      },
    },
  },
};

describe('normalizeSpec — OAS 3.0', () => {
  let routes: RouteModel[];
  let openapiVersion: string;

  beforeAll(async () => {
    const result = normalizeSpec(await deref(OAS3_PETSTORE));
    routes = result.routes;
    openapiVersion = result.openapiVersion;
  });

  test('版本识别与路径前缀拼接', () => {
    expect(openapiVersion).toBe('3.0.3');
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /v2/pets');
    expect(paths).toContain('GET /v2/pets/{petId}');
    expect(paths).toContain('GET /v2/files/{filepath}');
    expect(paths).toContain('GET /v2/stream/events');
  });

  test('参数抽取（query + header + path）', () => {
    const list = routes.find((r) => r.operationId === 'listPets')!;
    expect(list.params.map((p) => `${p.in}:${p.name}`).sort()).toEqual([
      'header:X-Trace',
      'query:limit',
    ]);

    const get = routes.find((r) => r.operationId === 'getPet')!;
    expect(get.params).toHaveLength(1);
    expect(get.params[0]).toMatchObject({ name: 'petId', in: 'path', required: true });
  });

  test('请求体抽取 + readOnly/writeOnly 剥离', () => {
    const create = routes.find((r) => r.operationId === 'createPet')!;
    expect(create.requestBody?.contentType).toBe('application/json');
    expect(create.requestBody?.required).toBe(true);

    const schema = create.requestBody!.schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    // writeOnly 的 secret 在请求中保留，readOnly 的 createdAt 剥离
    expect(Object.keys(schema.properties ?? {})).toContain('secret');
    expect(Object.keys(schema.properties ?? {})).not.toContain('createdAt');
  });

  test('响应 schema 的 writeOnly 剥离 + nullable 转换', () => {
    const get = routes.find((r) => r.operationId === 'getPet')!;
    const res = get.responses.find((r) => r.status === 200)!;
    const props = (res.schema as { properties?: Record<string, unknown> }).properties ?? {};
    // readOnly 的 createdAt 保留在响应中；writeOnly 的 secret 从响应剥离
    expect(Object.keys(props)).toContain('createdAt');
    expect(Object.keys(props)).not.toContain('secret');

    const email = props['email'] as { type?: unknown };
    expect(email.type).toEqual(['string', 'null']);
  });

  test('成功状态码取最低 2xx', () => {
    expect(routes.find((r) => r.operationId === 'listPets')!.successStatus).toBe(200);
    expect(routes.find((r) => r.operationId === 'createPet')!.successStatus).toBe(201);
  });

  test('example 抽出', () => {
    const list = routes.find((r) => r.operationId === 'listPets')!;
    const res = list.responses.find((r) => r.status === 200)!;
    expect(res.example).toEqual({ data: { items: [], total: 0 } });
  });

  test('CRUD 推断', () => {
    expect(routes.find((r) => r.operationId === 'listPets')!.crud).toMatchObject({
      kind: 'list',
      resourceType: 'pets',
      listEnvelope: 'data.items',
    });
    expect(routes.find((r) => r.operationId === 'createPet')!.crud).toMatchObject({
      kind: 'create',
      resourceType: 'pets',
    });
    expect(routes.find((r) => r.operationId === 'getPet')!.crud).toMatchObject({
      kind: 'get',
      resourceType: 'pets',
      idParam: 'petId',
    });
    expect(routes.find((r) => r.operationId === 'deletePet')!.crud).toMatchObject({
      kind: 'delete',
    });
  });

  test('流式检测', () => {
    expect(routes.find((r) => r.operationId === 'downloadFile')!.streaming).toBe('download');
    expect(routes.find((r) => r.operationId === 'streamEvents')!.streaming).toBe('sse');
    expect(routes.find((r) => r.operationId === 'listPets')!.streaming).toBeUndefined();
  });

  test('schemaHash 稳定且区分差异', async () => {
    const a = normalizeSpec(await deref(OAS3_PETSTORE)).routes.find(
      (r) => r.operationId === 'listPets'
    )!;
    const b = normalizeSpec(await deref(OAS3_PETSTORE)).routes.find(
      (r) => r.operationId === 'listPets'
    )!;
    expect(a.schemaHash).toBe(b.schemaHash);

    const mutated = JSON.parse(JSON.stringify(OAS3_PETSTORE));
    mutated.paths['/pets'].get.parameters.push({
      name: 'extra',
      in: 'query',
      schema: { type: 'string' },
    });
    const c = normalizeSpec(await deref(mutated)).routes.find(
      (r) => r.operationId === 'listPets'
    )!;
    expect(c.schemaHash).not.toBe(a.schemaHash);
  });

  test('204 无内容响应', () => {
    const del = routes.find((r) => r.operationId === 'deletePet')!;
    const res = del.responses.find((r) => r.status === 204)!;
    expect(res.schema).toEqual({ type: 'null' });
  });
});

describe('normalizeSpec — Swagger 2.0', () => {
  let routes: RouteModel[];
  let openapiVersion: string;

  beforeAll(async () => {
    const result = normalizeSpec(await deref(SWAGGER2));
    routes = result.routes;
    openapiVersion = result.openapiVersion;
  });

  test('basePath 拼接', () => {
    expect(openapiVersion).toBe('2.0');
    expect(routes.map((r) => r.path)).toContain('/api/v1/users');
    expect(routes.map((r) => r.path)).toContain('/api/v1/upload');
  });

  test('body 参数 → requestBody', () => {
    const create = routes.find((r) => r.operationId === 'createUser')!;
    expect(create.requestBody?.contentType).toBe('application/json');
    expect(create.params.every((p) => p.in !== 'path')).toBe(true);
  });

  test('formData → multipart 请求体', () => {
    const upload = routes.find((r) => r.operationId === 'uploadFile')!;
    expect(upload.requestBody?.contentType).toBe('multipart/form-data');
    expect(upload.streaming).toBe('upload');
    const schema = upload.requestBody!.schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['file', 'note']);
    expect(schema.required).toEqual(['file']);
  });

  test('Swagger 2.0 平铺 schema 响应 + CRUD 推断', () => {
    const list = routes.find((r) => r.operationId === 'listUsers')!;
    expect(list.responses[0]?.schema).toBeDefined();
    expect(list.crud).toMatchObject({ kind: 'list', resourceType: 'users', listEnvelope: 'rows' });
  });
});

describe('normalizeSchema', () => {
  test('nullable → type 数组', () => {
    expect(normalizeSchema({ type: 'string', nullable: true })).toEqual({
      type: ['string', 'null'],
    });
  });

  test('噪音字段剥离', () => {
    const r = normalizeSchema({
      type: 'object',
      discriminator: { propertyName: 'x' },
      xml: { name: 'y' },
      externalDocs: { url: 'z' },
      example: { a: 1 },
      deprecated: true,
      properties: { a: { type: 'string' } },
    });
    expect(r).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });

  test('required 清理已剥离字段', () => {
    const r = normalizeSchema({
      type: 'object',
      required: ['a', 'gone'],
      properties: { a: { type: 'string' } },
    });
    expect(r['required']).toEqual(['a']);
  });

  test('深度嵌套不崩', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 50; i++) deep = { type: 'object', properties: { x: deep } };
    expect(() => normalizeSchema(deep)).not.toThrow();
  });
});
