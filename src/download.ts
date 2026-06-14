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
  return cleaned || 'video';
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
  const partPaths = segments.map((segment) => `${outPath}.p${segment.index}`);

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

  await concatFiles(partPaths, outPath);
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

async function concatFiles(parts: string[], outPath: string): Promise<void> {
  const out = createWriteStream(outPath, { flags: 'w' });
  try {
    for (const part of parts) {
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(part);
        readStream.on('error', reject);
        out.on('error', reject);
        readStream.on('end', () => resolve());
        readStream.pipe(out, { end: false });
      });
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
  await rename(partPath, outPath);
}
