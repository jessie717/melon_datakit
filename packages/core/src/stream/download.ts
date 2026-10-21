/**
 * 确定性下载流 —— 常量内存产出任意大小的内容。
 *
 * 同 seed → 字节级相同（sha256 可校验）；
 * 按 64KB 块派生（块级 seed），支持 Range 只生成请求的区间。
 */
import { fieldSeed } from '../seed';

export const BLOCK_SIZE = 64 * 1024;

/** 由 seed 确定性填充一块字节 */
export function fillBlock(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  // xorshift32 —— 与 mulberry32 同族，够快且确定
  let x = seed | 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export interface DownloadRange {
  start: number;
  end: number; // 含端点
}

/**
 * 生成下载内容的分块生成器。
 * 只在内存里保留一个块 —— 大文件不涨内存。
 */
export function* downloadBlocks(
  opSeed: number,
  range: DownloadRange,
  totalSize: number
): Generator<Uint8Array> {
  const end = Math.min(range.end, totalSize - 1);
  if (range.start > end || range.start < 0) return;

  const firstBlock = Math.floor(range.start / BLOCK_SIZE);
  const lastBlock = Math.floor(end / BLOCK_SIZE);

  for (let b = firstBlock; b <= lastBlock; b++) {
    const blockStart = b * BLOCK_SIZE;
    const block = fillBlock(fieldSeed(opSeed, `block#${b}`), BLOCK_SIZE);
    const from = Math.max(0, range.start - blockStart);
    const to = Math.min(BLOCK_SIZE - 1, end - blockStart);
    yield block.subarray(from, to + 1);
  }
}

/** 由生成器产出 ReadableStream（带 abort 取消，客户端断开即停） */
export function blocksToStream(
  blocks: Generator<Uint8Array>,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const it = blocks;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = it.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel() {
      it.return(undefined as never);
    },
  });
  // signal 由调用方挂 abort → stream.cancel()
  void signal;
}

/** 解析 Range: bytes=start-end（仅支持单区间） */
export function parseRange(
  header: string | null,
  totalSize: number
): DownloadRange | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (!startStr && !endStr) return null;

  if (!startStr) {
    // bytes=-N 后缀区间
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    const start = Math.max(0, totalSize - suffix);
    return { start, end: totalSize - 1 };
  }

  const start = Number(startStr);
  const end = endStr ? Number(endStr) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= totalSize) return 'unsatisfiable';
  return { start, end: Math.min(end, totalSize - 1) };
}
