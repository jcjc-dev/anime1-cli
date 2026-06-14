import { describe, expect, it } from 'vitest';
import { isAbsolute, resolve, sep } from 'node:path';
import { parseMinInterval, resolveBaseDir, resolveSeriesDir } from '../src/args.js';

describe('parseMinInterval', () => {
  it('returns the fallback when the flag is omitted', () => {
    expect(parseMinInterval(undefined, 250)).toBe(250);
  });
  it('parses a valid numeric string', () => {
    expect(parseMinInterval('500', 250)).toBe(500);
    expect(parseMinInterval('0', 250)).toBe(0);
  });
  it('throws on a unit-suffixed value rather than silently disabling the gate', () => {
    expect(() => parseMinInterval('250ms', 250)).toThrow(/non-negative/);
  });
  it('throws on non-numeric or negative input', () => {
    expect(() => parseMinInterval('abc', 250)).toThrow();
    expect(() => parseMinInterval('-5', 250)).toThrow();
  });
});

describe('resolveBaseDir', () => {
  it('falls back on empty or whitespace input', () => {
    expect(resolveBaseDir('', './downloads')).toBe('./downloads');
    expect(resolveBaseDir('   ', './downloads')).toBe('./downloads');
    expect(resolveBaseDir(undefined, './downloads')).toBe('./downloads');
  });
  it('keeps a real directory', () => {
    expect(resolveBaseDir('./anime', './downloads')).toBe('./anime');
  });
});

describe('resolveSeriesDir', () => {
  it('joins a normal subdirectory under base', () => {
    const base = './downloads';
    expect(resolveSeriesDir(base, 'My Series')).toBe(resolve(base, 'My Series'));
  });
  it('returns base when there is no subdirectory', () => {
    expect(resolveSeriesDir('./downloads', '')).toBe(resolve('./downloads'));
  });
  it('rejects traversal and absolute segments', () => {
    expect(() => resolveSeriesDir('./downloads', '..')).toThrow(/unsafe/);
    expect(() => resolveSeriesDir('./downloads', '.')).toThrow(/unsafe/);
    const abs = `${sep}etc`;
    expect(isAbsolute(abs)).toBe(true);
    expect(() => resolveSeriesDir('./downloads', abs)).toThrow();
  });
});
