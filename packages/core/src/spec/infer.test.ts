import { describe, expect, test } from 'bun:test';
import { detectListEnvelope, inferCrud, inferStreaming } from './infer';

describe('inferCrud', () => {
  test('集合路径 GET → list', () => {
    const r = inferCrud('/users', 'GET', 'data.items');
    expect(r.kind).toBe('list');
    expect(r.resourceType).toBe('users');
    expect(r.listEnvelope).toBe('data.items');
  });

  test('集合路径 POST → create', () => {
    const r = inferCrud('/users', 'POST');
    expect(r.kind).toBe('create');
    expect(r.resourceType).toBe('users');
  });

  test('单实体路径 GET/PUT/DELETE', () => {
    expect(inferCrud('/users/{id}', 'GET').kind).toBe('get');
    expect(inferCrud('/users/{id}', 'PUT').kind).toBe('update');
    expect(inferCrud('/users/{id}', 'PATCH').kind).toBe('update');
    expect(inferCrud('/users/{id}', 'DELETE').kind).toBe('delete');

    const g = inferCrud('/users/{id}', 'GET');
    expect(g.resourceType).toBe('users');
    expect(g.idParam).toBe('id');
  });

  test('动作型路径（两段纯静态）→ none', () => {
    expect(inferCrud('/report/generate', 'GET').kind).toBe('none');
    expect(inferCrud('/auth/login', 'POST').kind).toBe('none');
    expect(inferCrud('/a/b/c', 'GET').kind).toBe('none');
  });

  test('嵌套资源 /users/{id}/posts', () => {
    const list = inferCrud('/users/{id}/posts', 'GET', '');
    expect(list.kind).toBe('list');
    expect(list.resourceType).toBe('posts');

    const item = inferCrud('/users/{id}/posts/{postId}', 'GET');
    expect(item.kind).toBe('get');
    expect(item.resourceType).toBe('posts');
    expect(item.idParam).toBe('postId');
  });

  test('通配参数不当作实体主键', () => {
    expect(inferCrud('/files/{filepath}', 'GET').kind).toBe('none');
    expect(inferCrud('/files/{path}', 'DELETE').kind).toBe('none');
  });

  test('单段动作路径 GET 不误判为 list 之外的东西', () => {
    // /health 这类单段 GET 推断为 list（可 UI 修正为 none），至少不崩
    const r = inferCrud('/health', 'GET');
    expect(['list', 'none']).toContain(r.kind);
  });
});

describe('inferStreaming', () => {
  test('multipart → upload', () => {
    expect(
      inferStreaming({
        requestBodyContentTypes: ['multipart/form-data'],
        requestBodySchemas: [],
        responseContentTypes: ['application/json'],
        responseSchemas: [],
      })
    ).toBe('upload');
  });

  test('binary format → download', () => {
    expect(
      inferStreaming({
        requestBodyContentTypes: [],
        requestBodySchemas: [],
        responseContentTypes: ['application/octet-stream'],
        responseSchemas: [{ type: 'string', format: 'binary' }],
      })
    ).toBe('download');
  });

  test('event-stream → sse', () => {
    expect(
      inferStreaming({
        requestBodyContentTypes: [],
        requestBodySchemas: [],
        responseContentTypes: ['text/event-stream'],
        responseSchemas: [],
      })
    ).toBe('sse');
  });

  test('普通 JSON → undefined', () => {
    expect(
      inferStreaming({
        requestBodyContentTypes: ['application/json'],
        requestBodySchemas: [{ type: 'object' }],
        responseContentTypes: ['application/json'],
        responseSchemas: [{ type: 'object' }],
      })
    ).toBeUndefined();
  });
});

describe('detectListEnvelope', () => {
  test('顶层数组', () => {
    expect(detectListEnvelope({ type: 'array', items: {} })).toBe('');
  });

  test('data.items 信封', () => {
    expect(
      detectListEnvelope({
        type: 'object',
        properties: {
          code: { type: 'integer' },
          data: {
            type: 'object',
            properties: { items: { type: 'array' }, total: { type: 'integer' } },
          },
        },
      })
    ).toBe('data.items');
  });

  test('rows 平铺', () => {
    expect(
      detectListEnvelope({
        type: 'object',
        properties: {
          rows: { type: 'array' },
          total: { type: 'integer' },
        },
      })
    ).toBe('rows');
  });

  test('无数组 → undefined', () => {
    expect(detectListEnvelope({ type: 'object', properties: {} })).toBeUndefined();
  });
});
