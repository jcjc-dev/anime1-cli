import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_CONNECTIONS, MIN_SEGMENT_SIZE } from './constants.js';
import { httpRequest } from './http.js';
import type { NetOptions, ResolvedSource } from './types.js';

export interface DownloadProgress {
  received: number;
  total: number | null;
}

export interface DownloadOptions {
  net?: NetOptions;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Number of parallel connections used to fetch a single file. */
  connections?: number;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
    .trim();
  // A title of "." or ".." (or only dots) would traverse directories when used
  // as a path segment; never let the sanitized value be a relative path token.
  if (cleaned === '' || /^\.+$/.test(cleaned)) return 'video';
  return cleaned;
}

export function extensionFromType(type: string): string {
  if (/webm/i.test(type)) return 'webm';
  if (/matroska/i.test(type)) return 'mkv';
  return 'mp4';
}

export interface Segment {
  index: number;
  start: number;
  end: number;
}

/** Splits a byte range [0, total) into up to `connections` contiguous segments. */
export function planSegments(total: number, connections: number): Segment[] {
  const count = Math.max(1, Math.floor(connections));
  const segLen = Math.ceil(total / count);
  const segments: Segment[] = [];
  for (let index = 0, start = 0; start < total; index++, start += segLen) {
    segments.push({ index, start, end: Math.min(start + segLen, total) - 1 });
  }
  return segments;
}

function cookieHeaderOf(source: ResolvedSource): string {
  return Object.entries(source.cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function sizeOrZero(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * Downloads a resolved video source to disk. When `connections > 1` and the
 * server reports a size and supports ranges, the file is fetched in parallel
 * segments (typically several times faster); otherwise a single resumable
 * stream is used.
 */
export async function downloadSource(
  source: ResolvedSource,
  outPath: string,
  options: DownloadOptions = {},
): Promise<void> {
  if (source.isHls) {
    throw new Error('This episode is an HLS stream (.m3u8), which is not supported for download yet.');
  }
  const { net = {}, onProgress, signal, connections = 1 } = options;
  await mkdir(dirname(outPath), { recursive: true });

  if (connections > 1) {
    const total = await probeTotalSize(source, net, signal);
    if (total != null && total >= MIN_SEGMENT_SIZE) {
      await downloadSegmented(source, outPath, total, Math.min(connections, MAX_CONNECTIONS), {
        net,
        onProgress,
        signal,
      });
      return;
    }
  }
  await downloadSingle(source, outPath, { net, onProgress, signal });
}

async function probeTotalSize(
  source: ResolvedSource,
  net: NetOptions,
  signal: AbortSignal | undefined,
): Promise<number | null> {
  const headers: Record<string, string> = { Range: 'bytes=0-0' };
  const cookie = cookieHeaderOf(source);
  if (cookie) headers.Cookie = cookie;
  const res = await httpRequest(source.src, { net, headers, signal });
  const contentRange = res.headers.get('content-range');
  void res.body?.cancel();
  if (res.status !== 206 || !contentRange) return null;
  const match = contentRange.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

async function downloadSegmented(
  source: ResolvedSource,
  outPath: string,
  total: number,
  connections: number,
  options: Required<Pick<DownloadOptions, 'net'>> & Pick<DownloadOptions, 'onProgress' | 'signal'>,
): Promise<void> {
  const { net, onProgress, signal } = options;
  const segments = planSegments(total, connections);
  // Encode the segment plan (total size + connection count) into the part name so
  // a resume with a different plan can never append onto a stale, wrong-range part.
  const planTag = `t${total}.c${connections}`;
  const partPaths = segments.map((segment) => `${outPath}.${planTag}.p${segment.index}`);

  const existing = await Promise.all(partPaths.map(sizeOrZero));
  const haves = segments.map((segment, i) => Math.min(existing[i], segment.end - segment.start + 1));
  let received = haves.reduce((sum, value) => sum + value, 0);
  const report = (): void => onProgress?.({ received, total });
  report();

  await Promise.all(
    segments.map((segment, i) =>
      downloadSegment(source, segment, partPaths[i], haves[i], net, signal, (delta) => {
        received += delta;
        report();
      }),
    ),
  );

  // Verify every part is exactly its planned length before assembling. A short
  // part means a segment silently under-downloaded; fail loudly and keep parts.
  const sizes = await Promise.all(partPaths.map(sizeOrZero));
  for (let i = 0; i < segments.length; i++) {
    const expected = segments[i].end - segments[i].start + 1;
    if (sizes[i] !== expected) {
      throw new Error(
        `Segment ${i} size mismatch: expected ${expected} bytes, found ${sizes[i]}. ` +
          'Download incomplete; rerun to resume.',
      );
    }
  }

  const parts = segments.map((segment, i) => ({
    path: partPaths[i],
    length: segment.end - segment.start + 1,
  }));
  // Assemble into a temp file, then atomically rename, so an interrupted concat
  // never leaves a truncated file under the real name.
  const tmpPath = `${outPath}.assembling`;
  await concatFiles(parts, tmpPath);
  const assembled = await sizeOrZero(tmpPath);
  if (assembled !== total) {
    await rm(tmpPath, { force: true });
    throw new Error(`Assembled size ${assembled} does not match expected ${total}.`);
  }
  await rename(tmpPath, outPath);
  await Promise.all(partPaths.map((path) => rm(path, { force: true })));
}

async function downloadSegment(
  source: ResolvedSource,
  segment: Segment,
  partPath: string,
  have: number,
  net: NetOptions,
  signal: AbortSignal | undefined,
  onDelta: (bytes: number) => void,
): Promise<void> {
  const length = segment.end - segment.start + 1;
  if (have >= length) return;

  const resuming = have > 0;
  const headers: Record<string, string> = { Range: `bytes=${segment.start + have}-${segment.end}` };
  const cookie = cookieHeaderOf(source);
  if (cookie) headers.Cookie = cookie;

  const res = await httpRequest(source.src, { net, headers, signal });
  if (res.status !== 206) {
    void res.body?.cancel();
    throw new Error(`Segment ${segment.index}: expected HTTP 206, got ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`Segment ${segment.index}: empty response body`);
  }

  const fileStream = createWriteStream(partPath, { flags: resuming ? 'a' : 'w' });
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('data', (chunk: Buffer) => onDelta(chunk.length));
  await pipeline(nodeStream, fileStream);
}

async function concatFiles(
  parts: Array<{ path: string; length: number }>,
  outPath: string,
): Promise<void> {
  const out = createWriteStream(outPath, { flags: 'w' });
  // 'error' handler attached once, not per-iteration.
  const outErr = new Promise<never>((_, reject) => out.on('error', reject));
  try {
    for (const part of parts) {
      await Promise.race([
        outErr,
        new Promise<void>((resolve, reject) => {
          // Bound the read to the segment's expected length so a stale, oversized
          // part can never overflow the reassembled file.
          const readStream = createReadStream(part.path, { start: 0, end: part.length - 1 });
          readStream.on('error', reject);
          readStream.on('end', () => resolve());
          readStream.pipe(out, { end: false });
        }),
      ]);
    }
  } finally {
    out.end();
    await once(out, 'finish');
  }
}

/** Single-stream download that resumes from a partial `.part` file. */
async function downloadSingle(
  source: ResolvedSource,
  outPath: string,
  options: DownloadOptions,
): Promise<void> {
  const { net = {}, onProgress, signal } = options;
  const partPath = `${outPath}.part`;
  let startByte = await sizeOrZero(partPath);

  const headers: Record<string, string> = {};
  const cookie = cookieHeaderOf(source);
  if (cookie) headers.Cookie = cookie;
  if (startByte > 0) headers.Range = `bytes=${startByte}-`;

  const res = await httpRequest(source.src, { net, headers, signal });
  if (res.status === 416) {
    // 416 means our start offset is past the server's size — usually the .part is
    // already complete. Verify its size matches the real total before promoting;
    // a stale/oversized .part must be discarded, not renamed to the final file.
    const realTotal = await probeTotalSize(source, net, signal);
    if (realTotal != null && startByte !== realTotal) {
      await rm(partPath, { force: true });
      throw new Error('Local partial file does not match the server; restarting. Rerun to download.');
    }
    await rename(partPath, outPath);
    return;
  }
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  if (!res.body) {
    throw new Error('Download response had an empty body');
  }

  const resuming = res.status === 206 && startByte > 0;
  if (!resuming) startByte = 0;
  const contentLength = Number(res.headers.get('Content-Length') ?? '0');
  const total = contentLength > 0 ? (resuming ? startByte + contentLength : contentLength) : null;
  let received = startByte;

  const fileStream = createWriteStream(partPath, { flags: resuming ? 'a' : 'w' });
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.({ received, total });
  });

  await pipeline(nodeStream, fileStream);
  if (total != null && received !== total) {
    throw new Error(
      `Download incomplete: received ${received} of ${total} bytes. Rerun to resume.`,
    );
  }
  await rename(partPath, outPath);
}
