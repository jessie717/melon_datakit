import { describe, expect, test } from 'bun:test';
import { checkConflicts } from './conflict';

describe('checkConflicts', () => {
  test('无冲突返回空', () => {
    expect(
      checkConflicts({ slug: 'my-app', paths: ['/users', '/users/{id}'], existingSlugs: [] })
    ).toEqual([]);
  });

  test('slug 格式非法', () => {
    const errs = checkConflicts({ slug: 'My_App', paths: [], existingSlugs: [] });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('My_App');
  });

  test('slug 保留字', () => {
    expect(
      checkConflicts({ slug: '_datakit', paths: [], existingSlugs: [] }).length
    ).toBeGreaterThan(0);
    expect(checkConflicts({ slug: 'admin', paths: [], existingSlugs: [] }).length).toBeGreaterThan(0);
    expect(checkConflicts({ slug: 'p', paths: [], existingSlugs: [] }).length).toBeGreaterThan(0);
  });

  test('slug 撞已有项目', () => {
    const errs = checkConflicts({ slug: 'dup', paths: [], existingSlugs: ['dup', 'other'] });
    expect(errs.some((e) => e.includes('已被其他项目占用'))).toBe(true);
  });

  test('路径撞保留前缀', () => {
    const errs = checkConflicts({
      slug: 'ok',
      paths: ['/_datakit/admin/evil'],
      existingSlugs: [],
    });
    expect(errs.some((e) => e.includes('/_datakit'))).toBe(true);
  });

  test('路径以 /p/ 开头产生歧义', () => {
    const errs = checkConflicts({
      slug: 'ok',
      paths: ['/p/other-project/users'],
      existingSlugs: [],
    });
    expect(errs.some((e) => e.includes('/p/'))).toBe(true);
  });

  test('多个问题同时报告', () => {
    const errs = checkConflicts({
      slug: 'BAD slug',
      paths: ['/_datakit/x', '/p/y'],
      existingSlugs: [],
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});
