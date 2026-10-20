import { describe, expect, test } from 'bun:test';
import {
  fieldSeed,
  fnv1a32,
  mulberry32,
  operationSeed,
  optionalPresent,
  requestFingerprint,
  stableStringify,
} from './seed';

describe('fnv1a32', () => {
  test('稳定且区分输入', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'));
  });
});

describe('stableStringify', () => {
  test('key 顺序不影响结果', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ a: { x: 1, y: 2 } })).toBe(
      stableStringify({ a: { y: 2, x: 1 } })
    );
  });
});

describe('requestFingerprint', () => {
  test('query 顺序无关', () => {
    const f1 = requestFingerprint('GET', '/users', { b: '2', a: '1' });
    const f2 = requestFingerprint('get', '/users', { a: '1', b: '2' });
    expect(f1).toBe(f2);
  });
});

describe('operationSeed / fieldSeed', () => {
  const base = {
    projectSalt: 'salt',
    operationKey: 'GET /users',
    fingerprint: 'GET /users {}',
    scenario: 'default',
  };

  test('同输入同 seed', () => {
    expect(operationSeed(base)).toBe(operationSeed({ ...base }));
  });

  test('seedOverride 直接生效', () => {
    expect(operationSeed({ ...base, seedOverride: 42 })).toBe(42);
  });

  test('字段级 seed：兄弟字段不漂移', () => {
    const op = operationSeed(base);
    const nameSeed = fieldSeed(op, 'user.name');
    const ageSeed = fieldSeed(op, 'user.age');
    expect(nameSeed).not.toBe(ageSeed);
    // 新增字段不影响已有字段的 seed
    const nameSeed2 = fieldSeed(op, 'user.name');
    expect(nameSeed2).toBe(nameSeed);
  });

  test('optionalPresent 确定性', () => {
    const op = operationSeed(base);
    const r1 = optionalPresent(op, 'user.email');
    const r2 = optionalPresent(op, 'user.email');
    expect(r1).toBe(r2);
  });
});

describe('mulberry32', () => {
  test('同 seed 同序列', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  test('值域 [0,1)', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
