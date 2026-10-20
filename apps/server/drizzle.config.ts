import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// 显式补载 monorepo 根的 .env（drizzle-kit 从 apps/server 启动，读不到根配置）
// 注意：drizzle-kit 会编译本配置，import.meta.dir 在其上下文里可能为 undefined，
// 因此以 process.cwd() 为锚点向上查找。
const here = process.cwd();
for (const file of [
  resolve(here, '../../.env'),
  resolve(here, '../.env'),
  resolve(here, './.env'),
]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // drizzle-kit 读取配置时也要求该变量；给出清晰报错而非静默失败
  throw new Error(
    'DATABASE_URL 未设置。请复制 .env.example 为 .env 并配置 PostgreSQL 连接串。'
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
