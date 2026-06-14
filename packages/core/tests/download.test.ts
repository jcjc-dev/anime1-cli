import { describe, expect, it } from 'vitest';
import { planSegments } from '../src/download.js';

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
