import { describe, expect, test } from 'bun:test';
import type { RouteModel } from '@datakit/shared';
import { validateRequest } from './index';

const ROUTE: RouteModel = {
  id: 'GET /users/{id}',
  method: 'GET',
  path: '/users/{id}',
  tags: [],
  params: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 100 } },
    { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } },
  ],
  responses: [],
  successStatus: 200,
  schemaHash: 'x',
};

const POST_ROUTE: RouteModel = {
  id: 'POST /users',
  method: 'POST',
  path: '/users',
  tags: [],
  params: [],
  requestBody: {
    contentType: 'application/json',
    required: true,
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
        age: { type: 'integer', minimum: 0 },
      },
    },
  },
  responses: [],
  successStatus: 201,
  schemaHash: 'y',
};

describe('validateRequest — strict 拒绝', () => {
  test('合法请求通过', () => {
    const r = validateRequest(
      {
        route: ROUTE,
        params: { id: '42' },
        query: { limit: '10' },
        headers: { 'X-Trace': 'abc' },
      },
      'strict'
    );
    expect(r.issues).toEqual([]);
    expect(r.shouldReject).toBe(false);
  });

  test('缺必填 header → 拒绝', () => {
    const r = validateRequest(
      { route: ROUTE, params: { id: '42' }, query: {}, headers: {} },
      'strict'
    );
    expect(r.shouldReject).toBe(true);
    const issue = r.issues.find((i) => i.in === 'header');
    expect(issue?.keyword).toBe('required');
  });

  test('query 超上限 → 拒绝，details 带 keyword', () => {
    const r = validateRequest(
      {
        route: ROUTE,
        params: { id: '42' },
        query: { limit: '999' },
        headers: { 'X-Trace': 'abc' },
      },
      'strict'
    );
    expect(r.shouldReject).toBe(true);
    const issue = r.issues.find((i) => i.in === 'query');
    expect(issue?.name).toBe('limit');
    expect(issue?.keyword).toBe('maximum');
  });

  test('query 字符串自动 coerce 成数字', () => {
    const r = validateRequest(
      {
        route: ROUTE,
        params: { id: '42' },
        query: { limit: '50' },
        headers: { 'X-Trace': 'abc' },
      },
      'strict'
    );
    expect(r.issues).toEqual([]);
  });

  test('body 缺必填 → 拒绝', () => {
    const r = validateRequest(
      { route: POST_ROUTE, params: {}, query: {}, headers: {}, body: { age: 3 } },
      'strict'
    );
    expect(r.shouldReject).toBe(true);
    expect(r.issues.find((i) => i.in === 'body')?.keyword).toBe('required');
  });

  test('body 类型错误 → 拒绝', () => {
    const r = validateRequest(
      { route: POST_ROUTE, params: {}, query: {}, headers: {}, body: { name: 'a', age: 'x' } },
      'strict'
    );
    expect(r.shouldReject).toBe(true);
  });
});

describe('validateRequest — lenient / off', () => {
  test('lenient 有问题但不拒', () => {
    const r = validateRequest(
      { route: ROUTE, params: { id: '42' }, query: { limit: '999' }, headers: {} },
      'lenient'
    );
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.shouldReject).toBe(false);
  });

  test('off 完全跳过', () => {
    const r = validateRequest(
      { route: ROUTE, params: {}, query: {}, headers: {} },
      'off'
    );
    expect(r.issues).toEqual([]);
    expect(r.shouldReject).toBe(false);
  });
});
