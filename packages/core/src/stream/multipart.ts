/**
 * 流式 multipart/form-data 解析器 —— 文件不进内存。
 *
 * 边扫描边界边处理：文件 part 流式计数/哈希/可选拦截，字段 part 才驻留内存。
 * 内存占用 ≈ 一个尾部残余块，与文件大小无关。
 *
 * 状态机：preamble → headers ⇄ body → done
 *   body 结构：--boundary CRLF headers CRLFCRLF content CRLF--boundary [CRLF … | --]
 */
import { createHash } from 'node:crypto';

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: MultipartFile[];
  /** body 总字节数（含边界与头） */
  totalBytes: number;
}

export interface MultipartOptions {
  /** 普通字段的内存上限（超限截断） */
  maxFieldBytes?: number;
  /** 文件块回调：可用于落盘/转发；chunk 用完即弃 */
  onFileChunk?: (file: { field: string; filename: string }, chunk: Uint8Array) => void;
}

interface PartState {
  field: string;
  filename?: string;
  contentType: string;
  isFile: boolean;
  hash: ReturnType<typeof createHash>;
  size: number;
  buffer: number[]; // 仅字段用
}

const CRLF = '\r\n';
const CRLFCRLF = '\r\n\r\n';

export async function parseMultipartStream(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  options: MultipartOptions = {}
): Promise<MultipartResult> {
  const maxFieldBytes = options.maxFieldBytes ?? 1024 * 1024;
  const delimiter = `--${boundary}`;
  const marker = `${CRLF}${delimiter}`;
  // 尾部保留：可能被切断的最长标记（marker + "--"）
  const tailKeep = marker.length + 4;

  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  let totalBytes = 0;

  let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let state: 'preamble' | 'headers' | 'body' = 'preamble';
  let done = false;
  let part: PartState | null = null;

  const concat = (a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> => {
    if (a.length === 0) return b;
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };

  const indexOf = (needle: string, from: number): number => {
    const n = needle.length;
    outer: for (let i = Math.max(0, from); i <= buf.length - n; i++) {
      for (let j = 0; j < n; j++) {
        if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
      }
      return i;
    }
    return -1;
  };

  const emitContent = (bytes: Uint8Array) => {
    if (!part || bytes.length === 0) return;
    if (part.isFile) {
      part.hash.update(bytes);
      part.size += bytes.length;
      options.onFileChunk?.({ field: part.field, filename: part.filename ?? '' }, bytes);
    } else {
      for (let i = 0; i < bytes.length && part.buffer.length < maxFieldBytes; i++) {
        part.buffer.push(bytes[i]!);
      }
    }
  };

  const flushPart = () => {
    if (!part) return;
    if (part.isFile) {
      files.push({
        field: part.field,
        filename: part.filename ?? '',
        contentType: part.contentType,
        size: part.size,
        sha256: part.hash.digest('hex'),
      });
    } else {
      fields[part.field] = Buffer.from(part.buffer).toString('utf8');
    }
    part = null;
  };

  for await (const chunk of body) {
    if (done) break;
    totalBytes += chunk.length;
    buf = concat(buf, chunk);

    let progress = true;
    while (true) {
      if (done) break;
      progress = false;

      if (state === 'preamble') {
        const first = indexOf(delimiter, 0);
        if (first === -1) break;
        const after = first + delimiter.length;
        // "--" 紧随 → 空 body 直接结束
        if (buf[after] === 0x2d && buf[after + 1] === 0x2d) {
          done = true;
          break;
        }
        if (after + 2 > buf.length) break; // CRLF 未到齐
        buf = buf.subarray(after + 2); // 跳过 delimiter 后的 CRLF
        state = 'headers';
        progress = true;
        continue;
      }

      if (state === 'headers') {
        const headerEnd = indexOf(CRLFCRLF, 0);
        if (headerEnd === -1) break;
        const headerText = Buffer.from(buf.subarray(0, headerEnd)).toString('utf8');
        const nameMatch = /name="([^"]*)"/i.exec(headerText);
        const fileMatch = /filename="([^"]*)"/i.exec(headerText);
        const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
        part = {
          field: nameMatch?.[1] ?? '',
          filename: fileMatch?.[1],
          contentType: typeMatch?.[1]?.trim() ?? 'application/octet-stream',
          isFile: !!fileMatch,
          hash: createHash('sha256'),
          size: 0,
          buffer: [],
        };
        buf = buf.subarray(headerEnd + 4);
        state = 'body';
        progress = true;
        continue;
      }

      if (state === 'body') {
        const hit = indexOf(marker, 0);
        if (hit === -1) {
          const safe = buf.length - tailKeep;
          if (safe > 0) {
            emitContent(buf.subarray(0, safe));
            buf = buf.subarray(safe);
          }
          break;
        }
        emitContent(buf.subarray(0, hit));
        flushPart();
        const after = hit + marker.length;
        const isEnd = buf[after] === 0x2d && buf[after + 1] === 0x2d;
        if (isEnd) {
          done = true;
          break;
        }
        if (after + 2 > buf.length) break;
        buf = buf.subarray(after + 2); // 跳过边界后 CRLF，进入下一段头
        state = 'headers';
        progress = true;
        continue;
      }
    }
    if (done) break;
  }

  return { fields, files, totalBytes };
}

/** 从 content-type 头解析 boundary */
export function extractBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2] ?? '').trim() : null;
}
