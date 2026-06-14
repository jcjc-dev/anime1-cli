import { describe, expect, it } from 'vitest';
import { displayWidth, formatDuration, formatSpeed, renderProgress, truncateToWidth } from '../src/ui.js';

describe('displayWidth', () => {
  it('counts ASCII as one column each', () => {
    expect(displayWidth('hello')).toBe(5);
  });

  it('counts CJK characters as two columns each', () => {
    expect(displayWidth('日本三國')).toBe(8);
    expect(displayWidth('A日B')).toBe(4);
  });
});

describe('truncateToWidth', () => {
  it('does not exceed the requested column width with CJK text', () => {
    const long = '成為悲劇元兇的最強異端 [05]';
    const out = truncateToWidth(long, 10);
    expect(displayWidth(out)).toBeLessThanOrEqual(10);
  });

  it('never splits a wide character across the boundary', () => {
    // width budget 3 with a 2-col char then ASCII: '日a' = 3 fits, '日ab' = 4 does not
    expect(truncateToWidth('日ab', 3)).toBe('日a');
    expect(displayWidth(truncateToWidth('日日日', 3))).toBeLessThanOrEqual(3);
  });

  it('returns the whole string when it already fits', () => {
    expect(truncateToWidth('abc', 10)).toBe('abc');
  });
});

describe('renderProgress', () => {
  it('renders a bar and percentage when total is known', () => {
    const out = renderProgress(50 * 1024 * 1024, 100 * 1024 * 1024);
    expect(out).toContain('50.0%');
    expect(out).toContain('MB');
  });

  it('falls back to bytes received when total is unknown', () => {
    expect(renderProgress(5 * 1024 * 1024, null)).toBe('5.0 MB');
  });
});

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(5)).toBe('0:05');
  });

  it('formats long durations as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('guards against invalid input', () => {
    expect(formatDuration(-1)).toBe('--:--');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('--:--');
  });
});

describe('formatSpeed', () => {
  it('uses MB/s at or above 1 MB/s', () => {
    expect(formatSpeed(4.4 * 1024 * 1024)).toBe('4.4 MB/s');
  });

  it('uses KB/s below 1 MB/s', () => {
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s');
  });

  it('returns empty string for non-positive rates', () => {
    expect(formatSpeed(0)).toBe('');
  });
});
