/**
 * 双进程并行启动 —— Bun 脚本执行器不支持 `&`，用 Bun.spawn 并行拉起。
 * 用法：bun scripts/parallel.ts dev|start
 */
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('用法: bun scripts/parallel.ts dev|start');
  process.exit(1);
}

const procs = [
  Bun.spawn(['bun', 'run', '--filter', '@datakit/server', mode], {
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
  Bun.spawn(['bun', 'run', '--filter', '@datakit/web', mode], {
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
];

const shutdown = (code: number) => {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      // 已退出
    }
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const codes = await Promise.all(procs.map((p) => p.exited));
shutdown(Math.max(codes[0] ?? 0, codes[1] ?? 0));
