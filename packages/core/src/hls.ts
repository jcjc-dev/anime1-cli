// HLS (m3u8) engine: parse master/media playlists, decrypt AES-128 segments
// with node:crypto, and assemble a single file. Output is the segment container
// passed through unchanged: MPEG-TS segments concatenate to a playable `.ts`,
// fMP4 (EXT-X-MAP) writes init + segments to a playable `.mp4`. No remux, so no
// ffmpeg and no extra dependency (AGENTS.md hard requirements 1 and 4).

import { createDecipheriv } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_CONNECTIONS } from './constants.js';
import { httpRequest } from './http.js';
import type { NetOptions, ResolvedSource } from './types.js';

export interface HlsKey {
  method: string;
  uri: string | null;
  iv: Buffer | null;
}

export interface HlsSegment {
  index: number;
  uri: string;
  duration: number;
  key: HlsKey | null;
  /** Effective AES-128 IV (explicit, or derived from the media sequence). */
  iv: Buffer;
}

export interface MediaPlaylist {
  segments: HlsSegment[];
  /** EXT-X-MAP init segment URI for fMP4 streams, when present. */
  mapUri: string | null;
  mediaSequence: number;
  encrypted: boolean;
}

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
}

function absolute(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Parses an HLS attribute list (`KEY=VALUE,KEY="quoted,value"`). */
export function parseAttributes(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < input.length) {
    let key = '';
    while (i < input.length && input[i] !== '=') key += input[i++];
    if (i >= input.length) break;
    i++; // skip '='
    let value = '';
    if (input[i] === '"') {
      i++;
      while (i < input.length && input[i] !== '"') value += input[i++];
      i++; // skip closing quote
    } else {
      while (i < input.length && input[i] !== ',') value += input[i++];
    }
    if (i < input.length && input[i] === ',') i++;
    out[key.trim()] = value;
  }
  return out;
}

/** Parses a hex string (optionally 0x-prefixed) into bytes. */
export function parseHex(value: string): Buffer {
  const hex = value.trim().replace(/^0x/i, '');
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`Invalid hex value: ${value}`);
  }
  return Buffer.from(hex, 'hex');
}

/** Builds the implicit AES-128 IV from a segment's absolute media sequence. */
export function ivForSequence(sequence: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(sequence))), 8);
  return iv;
}

export function isMasterPlaylist(text: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(text);
}

export function parseMasterPlaylist(text: string, baseUrl: string): { variants: HlsVariant[] } {
  const lines = text.split(/\r?\n/);
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
    const uri = j < lines.length ? absolute(lines[j].trim(), baseUrl) : null;
    if (uri) {
      variants.push({
        uri,
        bandwidth: Number(attrs.BANDWIDTH ?? attrs['AVERAGE-BANDWIDTH'] ?? '0') || 0,
        resolution: attrs.RESOLUTION ?? null,
      });
    }
    i = j;
  }
  return { variants };
}

/** Returns the highest-bandwidth variant, or null when there are none. */
export function selectVariant(variants: HlsVariant[]): HlsVariant | null {
  if (variants.length === 0) return null;
  return variants.reduce((best, variant) => (variant.bandwidth > best.bandwidth ? variant : best));
}

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.split(/\r?\n/);
  let currentKey: HlsKey | null = null;
  let mapUri: string | null = null;
  let mediaSequence = 0;
  let pendingDuration = 0;
  let index = 0;
  const segments: HlsSegment[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length).trim()) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = attrs.METHOD ?? 'NONE';
      currentKey =
        method === 'NONE'
          ? null
          : {
              method,
              uri: attrs.URI ? absolute(attrs.URI, baseUrl) : null,
              iv: attrs.IV ? parseHex(attrs.IV) : null,
            };
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) mapUri = absolute(attrs.URI, baseUrl);
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;

    const uri = absolute(line, baseUrl);
    if (!uri) continue;
    const iv = currentKey ? (currentKey.iv ?? ivForSequence(mediaSequence + index)) : Buffer.alloc(0);
    segments.push({ index, uri, duration: pendingDuration, key: currentKey, iv });
    pendingDuration = 0;
    index++;
  }

  return { segments, mapUri, mediaSequence, encrypted: segments.some((s) => s.key !== null) };
}

export interface HlsDownloadOptions {
  net?: NetOptions;
  onProgress?: (progress: { received: number; total: number | null }) => void;
  signal?: AbortSignal;
  connections?: number;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchText(
  url: string,
  net: NetOptions,
  cookie: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
  const res = await httpRequest(url, { net, headers, signal });
  if (!res.ok) throw new Error(`Failed to load HLS playlist ${url} (HTTP ${res.status})`);
  return res.text();
}

async function fetchBuffer(
  url: string,
  net: NetOptions,
  cookie: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
  const res = await httpRequest(url, { net, headers, signal });
  if (!res.ok) throw new Error(`Failed to fetch HLS resource ${url} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function decryptAes128(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = cursor++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

async function assemble(outPath: string, parts: string[]): Promise<void> {
  const out = createWriteStream(outPath, { flags: 'w' });
  const outErr = new Promise<never>((_, reject) => out.on('error', reject));
  try {
    for (const part of parts) {
      await Promise.race([
        outErr,
        new Promise<void>((resolve, reject) => {
          const read = createReadStream(part);
          read.on('error', reject);
          read.on('end', () => resolve());
          read.pipe(out, { end: false });
        }),
      ]);
    }
  } finally {
    out.end();
    await once(out, 'finish');
  }
}

/**
 * Downloads an HLS stream to `${outBasePath}.{ts,mp4}` and returns the final
 * path. Segments are written to a sibling `.hlsparts` directory and only
 * renamed into place once fully fetched and decrypted, so an interrupted run
 * resumes without re-downloading completed segments.
 */
export async function downloadHls(
  source: ResolvedSource,
  outBasePath: string,
  options: HlsDownloadOptions = {},
): Promise<string> {
  const { net = {}, onProgress, signal, connections = 1 } = options;
  const cookie = cookieHeader(source.cookies);

  let playlistUrl = source.src;
  let text = await fetchText(playlistUrl, net, cookie, signal);
  if (isMasterPlaylist(text)) {
    const best = selectVariant(parseMasterPlaylist(text, playlistUrl).variants);
    if (!best) throw new Error('HLS master playlist contained no variants.');
    playlistUrl = best.uri;
    text = await fetchText(playlistUrl, net, cookie, signal);
  }

  const media = parseMediaPlaylist(text, playlistUrl);
  if (media.segments.length === 0) throw new Error('HLS playlist contained no segments.');
  for (const segment of media.segments) {
    if (segment.key && segment.key.method !== 'AES-128') {
      throw new Error(`Unsupported HLS encryption method: ${segment.key.method}`);
    }
    if (segment.key && !segment.key.uri) {
      throw new Error('HLS segment is encrypted but the key URI is missing.');
    }
  }

  const finalPath = `${outBasePath}.${media.mapUri ? 'mp4' : 'ts'}`;
  if (await fileExists(finalPath)) return finalPath;
  await mkdir(dirname(finalPath), { recursive: true });
  const partsDir = `${outBasePath}.hlsparts`;
  await mkdir(partsDir, { recursive: true });

  const keyCache = new Map<string, Promise<Buffer>>();
  const getKey = (uri: string): Promise<Buffer> => {
    let pending = keyCache.get(uri);
    if (!pending) {
      pending = fetchBuffer(uri, net, cookie, signal).then((key) => {
        if (key.length !== 16) {
          throw new Error(`HLS key ${uri} was ${key.length} bytes, expected 16.`);
        }
        return key;
      });
      keyCache.set(uri, pending);
    }
    return pending;
  };

  let received = 0;
  const report = (): void => onProgress?.({ received, total: null });
  report();

  const parts: string[] = [];

  const initPath = media.mapUri ? join(partsDir, 'init') : null;
  if (media.mapUri && initPath) {
    if (!(await fileExists(initPath))) {
      const buffer = await fetchBuffer(media.mapUri, net, cookie, signal);
      await writeFile(`${initPath}.tmp`, buffer);
      await rename(`${initPath}.tmp`, initPath);
    }
    parts.push(initPath);
    received += (await stat(initPath)).size;
    report();
  }

  const limit = Math.min(Math.max(1, Math.floor(connections)), MAX_CONNECTIONS);
  await runPool(media.segments, limit, async (segment) => {
    const partFile = join(partsDir, `seg.${segment.index}`);
    if (await fileExists(partFile)) {
      received += (await stat(partFile)).size;
      report();
      return;
    }
    let buffer = await fetchBuffer(segment.uri, net, cookie, signal);
    if (segment.key) {
      const key = await getKey(segment.key.uri as string);
      buffer = decryptAes128(buffer, key, segment.iv);
    }
    await writeFile(`${partFile}.tmp`, buffer);
    await rename(`${partFile}.tmp`, partFile);
    received += buffer.length;
    report();
  });

  for (const segment of media.segments) parts.push(join(partsDir, `seg.${segment.index}`));

  const tmpOut = `${finalPath}.assembling`;
  await assemble(tmpOut, parts);
  await rename(tmpOut, finalPath);
  await rm(partsDir, { recursive: true, force: true });
  return finalPath;
}
