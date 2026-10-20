/**
 * 环境变量加载 —— 显式补载 monorepo 根的 .env。
 * Bun 只自动加载 cwd 下的 .env；从 apps/server 启动时读不到根配置。
 * 必须在任何读取 process.env 的模块之前 import。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  resolve(import.meta.dir, '../../../.env'), // monorepo 根
  resolve(import.meta.dir, '../../.env'), // apps/.env（备用）
  resolve(import.meta.dir, '../.env'), // apps/server/.env（备用）
];

for (const file of candidates) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
