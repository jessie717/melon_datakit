import { describe, expect, test } from 'bun:test';
import { buildMatcher, compilePath, matchPath, normalizePath } from './match';

describe('normalizePath', () => {
  test('尾斜杠归一化', () => {
    expect(normalizePath('/users/')).toBe('/users');
    expect(normalizePath('/users')).toBe('/users');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('users')).toBe('/users');
  });
});

describe('compilePath', () => {
  test('静态段与参数段', () => {
    const c = compilePath('/users/{id}/posts/{postId}');
    expect(c.segments.map((s) => s.kind)).toEqual([
      'static',
      'param',
      'static',
      'param',
    ]);
    expect(c.hasWildcard).toBe(false);
  });

  test('末位 path 参数视为通配', () => {
    const c = compilePath('/files/{filepath}');
    expect(c.hasWildcard).toBe(true);
    expect(c.segments.at(-1)).toEqual({ kind: 'wildcard', name: 'filepath' });
  });

  test('{+path} 显式通配', () => {
    const c = compilePath('/assets/{+rest}');
    expect(c.hasWildcard).toBe(true);
  });

  test('具体度：静态段多者分高', () => {
    const lit = compilePath('/pets/mine');
    const param = compilePath('/pets/{petId}');
    expect(lit.score).toBeGreaterThan(param.score);
  });
});

describe('matchPath', () => {
  const compiled = [
    compilePath('/pets/mine'),
    compilePath('/pets/{petId}'),
    compilePath('/users/{id}'),
    compilePath('/files/{filepath}'),
    compilePath('/'),
  ];

  test('静态段优先于参数段', () => {
    const r = matchPath(compiled, '/pets/mine');
    expect(r?.template).toBe('/pets/mine');
  });

  test('参数段抽取', () => {
    const r = matchPath(compiled, '/pets/123');
    expect(r?.template).toBe('/pets/{petId}');
    expect(r?.params).toEqual({ petId: '123' });
  });

  test('通配段吞掉剩余路径', () => {
    const r = matchPath(compiled, '/files/a/b/c.txt');
    expect(r?.template).toBe('/files/{filepath}');
    expect(r?.params).toEqual({ filepath: 'a/b/c.txt' });
  });

  test('URL 解码', () => {
    const r = matchPath(compiled, '/users/%E5%BC%A0%E4%B8%89');
    expect(r?.params).toEqual({ id: '张三' });
  });

  test('根路径', () => {
    const r = matchPath(compiled, '/');
    expect(r?.template).toBe('/');
  });

  test('无匹配返回 null', () => {
    expect(matchPath(compiled, '/unknown/path')).toBeNull();
    // 段数不一致
    expect(matchPath(compiled, '/users/1/extra')).toBeNull();
    expect(matchPath(compiled, '/pets')).toBeNull();
  });
});

describe('buildMatcher', () => {
  test('按方法分派', () => {
    const m = buildMatcher([
      { method: 'GET', path: '/users/{id}' },
      { method: 'DELETE', path: '/users/{id}' },
      { method: 'GET', path: '/users' },
    ]);
    expect(m.match('get', '/users/1')?.template).toBe('/users/{id}');
    expect(m.match('DELETE', '/users/1')?.template).toBe('/users/{id}');
    expect(m.match('GET', '/users')?.template).toBe('/users');
    expect(m.match('POST', '/users')).toBeNull();
    expect(m.match('GET', '/users/1/extra')).toBeNull();
  });
});
