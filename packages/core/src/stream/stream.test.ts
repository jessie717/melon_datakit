import { describe, expect, test } from 'bun:test';
import {
  blocksToStream,
  downloadBlocks,
  fillBlock,
  parseRange,
} from './download';
import { extractBoundary, parseMultipartStream } from './multipart';

// ============ download ============

describe('确定性下载流', () => {
  test('同 seed 同字节', () => {
    const a = [...downloadBlocks(42, { start: 0, end: 999 }, 1000)];
    const b = [...downloadBlocks(42, { start: 0, end: 999 }, 1000)];
    expect(Buffer.concat(a.map(Buffer.from)).toString('hex')).toBe(
      Buffer.concat(b.map(Buffer.from)).toString('hex')
    );
  });

  test('不同 seed 不同字节', () => {
    const a = [...downloadBlocks(1, { start: 0, end: 99 }, 100)];
    const b = [...downloadBlocks(2, { start: 0, end: 99 }, 100)];
    expect(Buffer.concat(a.map(Buffer.from)).toString('hex')).not.toBe(
      Buffer.concat(b.map(Buffer.from)).toString('hex')
    );
  });

  test('全量长度正确', () => {
    const blocks = [...downloadBlocks(7, { start: 0, end: 200000 - 1 }, 200000)];
    expect(Buffer.concat(blocks.map(Buffer.from)).length).toBe(200000);
  });

  test('Range 切片与全量对应位置一致', () => {
    const full = Buffer.concat([...downloadBlocks(9, { start: 0, end: 5000 }, 5001)].map(Buffer.from));
    const slice = Buffer.concat([...downloadBlocks(9, { start: 1000, end: 1999 }, 5001)].map(Buffer.from));
    expect(slice.toString('hex')).toBe(full.subarray(1000, 2000).toString('hex'));
  });

  test('fillBlock 确定性', () => {
    expect(Buffer.from(fillBlock(5, 32)).toString('hex')).toBe(
      Buffer.from(fillBlock(5, 32)).toString('hex')
    );
  });

  test('blocksToStream 可读出全部内容', async () => {
    const stream = blocksToStream(downloadBlocks(3, { start: 0, end: 100 }, 101));
    const chunks: Uint8Array[] = [];
    for await (const c of stream) chunks.push(c);
    expect(Buffer.concat(chunks.map(Buffer.from)).length).toBe(101);
  });
});

describe('parseRange', () => {
  const total = 1000;
  test('无 Range 头', () => {
    expect(parseRange(null, total)).toBeNull();
  });
  test('bytes=0-99', () => {
    expect(parseRange('bytes=0-99', total)).toEqual({ start: 0, end: 99 });
  });
  test('bytes=500- 开区间到尾', () => {
    expect(parseRange('bytes=500-', total)).toEqual({ start: 500, end: 999 });
  });
  test('bytes=-100 后缀', () => {
    expect(parseRange('bytes=-100', total)).toEqual({ start: 900, end: 999 });
  });
  test('超界 → unsatisfiable', () => {
    expect(parseRange('bytes=2000-3000', total)).toBe('unsatisfiable');
  });
  test('end 超界截断', () => {
    expect(parseRange('bytes=900-9999', total)).toEqual({ start: 900, end: 999 });
  });
});

// ============ multipart ============

const B = 'testboundary123';

function buildMultipart(
  parts: Array<{ name: string; filename?: string; contentType?: string; body: string | Uint8Array }>
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    let head = `--${B}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head));
    chunks.push(typeof p.body === 'string' ? Buffer.from(p.body) : p.body);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${B}--\r\n`));
  return Buffer.concat(chunks);
}

async function streamOf(chunks: Uint8Array[]): Promise<ReadableStream<Uint8Array>> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i++]!);
    },
  });
}

describe('parseMultipartStream', () => {
  test('单文件 + 字段', async () => {
    const fileContent = Buffer.from('hello file content');
    const body = buildMultipart([
      { name: 'note', body: 'a note' },
      { name: 'file', filename: 'a.txt', contentType: 'text/plain', body: fileContent },
    ]);
    const r = await parseMultipartStream(await streamOf([body]), B);
    expect(r.fields).toEqual({ note: 'a note' });
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ field: 'file', filename: 'a.txt', contentType: 'text/plain' });
    expect(r.files[0]!.size).toBe(fileContent.length);
    expect(r.totalBytes).toBe(body.length);
  });

  test('sha256 正确', async () => {
    const content = Buffer.from('abc');
    const body = buildMultipart([{ name: 'f', filename: 'x', body: content }]);
    const r = await parseMultipartStream(await streamOf([body]), B);
    // sha256('abc')
    expect(r.files[0]!.sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('边界跨 chunk 不丢数据', async () => {
    const fileContent = Buffer.alloc(5000, 0x41);
    const body = buildMultipart([
      { name: 'meta', body: 'v' },
      { name: 'f', filename: 'big.bin', body: fileContent },
    ]);
    // 切成 7 字节小块，必然切断边界标记
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < body.length; i += 7) {
      pieces.push(body.subarray(i, Math.min(i + 7, body.length)));
    }
    const r = await parseMultipartStream(await streamOf(pieces), B);
    expect(r.files[0]!.size).toBe(5000);
    expect(r.fields).toEqual({ meta: 'v' });
  });

  test('多文件', async () => {
    const body = buildMultipart([
      { name: 'f1', filename: 'a', body: 'aaa' },
      { name: 'f2', filename: 'b', body: 'bbbb' },
    ]);
    const r = await parseMultipartStream(await streamOf([body]), B);
    expect(r.files.map((f) => f.filename)).toEqual(['a', 'b']);
    expect(r.files.map((f) => f.size)).toEqual([3, 4]);
  });

  test('空文件', async () => {
    const body = buildMultipart([{ name: 'empty', filename: 'e', body: '' }]);
    const r = await parseMultipartStream(await streamOf([body]), B);
    expect(r.files[0]!.size).toBe(0);
  });

  test('onFileChunk 流式回调', async () => {
    const seen: number[] = [];
    const body = buildMultipart([
      { name: 'f', filename: 'x', body: Buffer.alloc(300, 0x62) },
    ]);
    await parseMultipartStream(await streamOf([body]), B, {
      onFileChunk: (_f, chunk) => seen.push(chunk.length),
    });
    expect(seen.reduce((a, b) => a + b, 0)).toBe(300);
  });
});

describe('extractBoundary', () => {
  test('普通与引号形式', () => {
    expect(extractBoundary('multipart/form-data; boundary=abc123')).toBe('abc123');
    expect(extractBoundary('multipart/form-data; boundary="a b c"')).toBe('a b c');
    expect(extractBoundary('application/json')).toBeNull();
  });
});
