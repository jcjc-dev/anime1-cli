import { describe, expect, it } from 'vitest';
import { planSegments, sanitizeFilename } from '../src/download.js';

describe('planSegments', () => {
  it('splits a total into contiguous, non-overlapping segments covering everything', () => {
    const total = 1000;
    const segments = planSegments(total, 4);
    expect(segments.length).toBe(4);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(total - 1);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBe(segments[i - 1].end + 1);
    }
    const covered = segments.reduce((sum, s) => sum + (s.end - s.start + 1), 0);
    expect(covered).toBe(total);
  });

  it('never produces a segment that extends past the end', () => {
    const total = 97;
    for (const conns of [1, 2, 3, 5, 8]) {
      const segments = planSegments(total, conns);
      expect(segments[segments.length - 1].end).toBe(total - 1);
      expect(segments.every((s) => s.end < total)).toBe(true);
    }
  });

  it('returns a single segment for one connection', () => {
    expect(planSegments(500, 1)).toEqual([{ index: 0, start: 0, end: 499 }]);
  });

  it('produces fewer segments than connections when the total is tiny', () => {
    const segments = planSegments(3, 8);
    expect(segments.length).toBeLessThanOrEqual(3);
    expect(segments[segments.length - 1].end).toBe(2);
  });
});

describe('sanitizeFilename', () => {
  it('replaces path separators and control chars', () => {
    expect(sanitizeFilename('a/b\\c')).toBe('a_b_c');
    expect(sanitizeFilename('na\x00me')).toBe('na_me');
  });

  it('never returns a directory-traversal token', () => {
    expect(sanitizeFilename('..')).toBe('video');
    expect(sanitizeFilename('.')).toBe('video');
    expect(sanitizeFilename('  ..  ')).toBe('video');
    expect(sanitizeFilename('...')).toBe('video');
  });

  it('falls back to "video" for empty input', () => {
    expect(sanitizeFilename('')).toBe('video');
    expect(sanitizeFilename('   ')).toBe('video');
  });

  it('preserves a normal title (incl. CJK) and caps length', () => {
    expect(sanitizeFilename('Frieren 葬送のフリーレン [01]')).toBe('Frieren 葬送のフリーレン [01]');
    expect(sanitizeFilename('x'.repeat(500)).length).toBe(180);
  });
});
