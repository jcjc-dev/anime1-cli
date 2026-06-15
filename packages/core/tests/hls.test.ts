import { describe, expect, it } from 'vitest';
import {
  ivForSequence,
  isMasterPlaylist,
  parseAttributes,
  parseHex,
  parseMasterPlaylist,
  parseMediaPlaylist,
  selectVariant,
} from '../src/hls.js';

describe('parseAttributes', () => {
  it('parses quoted and unquoted values, keeping commas inside quotes', () => {
    expect(parseAttributes('BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"')).toEqual(
      {
        BANDWIDTH: '800000',
        RESOLUTION: '640x360',
        CODECS: 'avc1.4d401f,mp4a.40.2',
      },
    );
  });
});

describe('parseHex', () => {
  it('parses an 0x-prefixed even-length hex string', () => {
    expect([...parseHex('0x00FF10')]).toEqual([0x00, 0xff, 0x10]);
  });
  it('rejects odd-length or non-hex values', () => {
    expect(() => parseHex('0xABC')).toThrow();
    expect(() => parseHex('zz')).toThrow();
  });
});

describe('ivForSequence', () => {
  it('encodes the sequence in the low 8 bytes, big-endian', () => {
    expect([...ivForSequence(0)]).toEqual(new Array(16).fill(0));
    const five = ivForSequence(5);
    expect(five.length).toBe(16);
    expect(five[15]).toBe(5);
    expect(five.subarray(0, 15).every((b) => b === 0)).toBe(true);
  });
});

describe('master playlist', () => {
  const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720p/index.m3u8
`;

  it('detects a master playlist', () => {
    expect(isMasterPlaylist(MASTER)).toBe(true);
    expect(isMasterPlaylist('#EXTM3U\n#EXTINF:9,\na.ts')).toBe(false);
  });

  it('parses variants and selects the highest bandwidth, resolving URIs', () => {
    const { variants } = parseMasterPlaylist(MASTER, 'https://cdn.example/hls/master.m3u8');
    expect(variants).toHaveLength(2);
    const best = selectVariant(variants);
    expect(best?.bandwidth).toBe(2000000);
    expect(best?.uri).toBe('https://cdn.example/hls/720p/index.m3u8');
    expect(best?.resolution).toBe('1280x720');
  });
});

describe('parseMediaPlaylist', () => {
  it('parses encrypted segments with an explicit IV and resolves URIs', () => {
    const text = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001
#EXTINF:9.009,
seg0.ts
#EXTINF:8.5,
seg1.ts
#EXT-X-ENDLIST`;
    const media = parseMediaPlaylist(text, 'https://cdn.example/hls/index.m3u8');
    expect(media.encrypted).toBe(true);
    expect(media.mapUri).toBeNull();
    expect(media.segments).toHaveLength(2);
    expect(media.segments[0].uri).toBe('https://cdn.example/hls/seg0.ts');
    expect(media.segments[0].duration).toBeCloseTo(9.009);
    expect(media.segments[0].key?.uri).toBe('https://cdn.example/hls/key.bin');
    expect([...media.segments[0].iv]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('derives the IV from the absolute media sequence when none is given', () => {
    const text = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-KEY:METHOD=AES-128,URI="https://k/key"
#EXTINF:6,
a.ts
#EXTINF:6,
b.ts`;
    const media = parseMediaPlaylist(text, 'https://cdn.example/index.m3u8');
    expect(media.segments[0].iv[15]).toBe(10);
    expect(media.segments[1].iv[15]).toBe(11);
  });

  it('captures the EXT-X-MAP init segment for fMP4 streams', () => {
    const text = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
0.m4s
#EXT-X-ENDLIST`;
    const media = parseMediaPlaylist(text, 'https://cdn.example/hls/index.m3u8');
    expect(media.mapUri).toBe('https://cdn.example/hls/init.mp4');
    expect(media.encrypted).toBe(false);
    expect(media.segments[0].uri).toBe('https://cdn.example/hls/0.m4s');
  });
});
