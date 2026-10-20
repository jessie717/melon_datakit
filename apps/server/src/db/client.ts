/**
 * Drizzle + postgres.js 客户端。
 * postgres.js 纯 JS，Bun/Windows 免原生编译。
 */
import '../env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 未设置。请复制 .env.example 为 .env 并配置 PostgreSQL 连接串。'
  );
}

const client = postgres(DATABASE_URL, {
  max: 10,
  onnotice: () => {
    // 屏蔽 PG notice 噪音
  },
});

export const db = drizzle(client, { schema });

export type Db = typeof db;

/** 优雅关闭连接池 */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

/** 连接自检（health 用） */
export async function pingDb(): Promise<boolean> {
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  }
}
