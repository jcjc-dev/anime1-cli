import { createCipheriv, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadHls } from '../src/hls.js';
import { setMinRequestInterval } from '../src/http.js';
import type { ResolvedSource } from '../src/types.js';

// A 16-byte AES-128 key and IV shared by the fixtures below.
const KEY = randomBytes(16);
const IV = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const PLAINTEXT_0 = Buffer.from('the quick brown fox '.repeat(64));
const PLAINTEXT_1 = Buffer.from('jumps over the lazy dog '.repeat(64));

function encrypt(plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Avoid the polite inter-request delay for a fast loopback test.
  setMinRequestInterval(0);
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/index.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:10',
          '#EXT-X-MEDIA-SEQUENCE:0',
          `#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x${IV.toString('hex')}`,
          '#EXTINF:9.0,',
          'seg0.ts',
          '#EXTINF:9.0,',
          'seg1.ts',
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
      );
      return;
    }
    if (path === '/key.bin') {
      res.end(KEY);
      return;
    }
    if (path === '/seg0.ts') {
      res.end(encrypt(PLAINTEXT_0));
      return;
    }
    if (path === '/seg1.ts') {
      res.end(encrypt(PLAINTEXT_1));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setMinRequestInterval(250);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('downloadHls', () => {
  it('downloads, AES-128-decrypts, and concatenates TS segments into a .ts file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anime1-hls-'));
    try {
      const source: ResolvedSource = {
        src: `${baseUrl}/index.m3u8`,
        type: 'application/vnd.apple.mpegurl',
        cookies: {},
        isHls: true,
      };
      const outPath = await downloadHls(source, join(dir, 'episode'), { connections: 2 });
      expect(outPath).toBe(join(dir, 'episode.ts'));
      const written = await readFile(outPath);
      expect(written.equals(Buffer.concat([PLAINTEXT_0, PLAINTEXT_1]))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
