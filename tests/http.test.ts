import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../src/http.js';

describe('parseRetryAfter', () => {
  it('parses a delay given in seconds', () => {
    expect(parseRetryAfter('120')).toBe(120000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses an HTTP-date into a non-negative delay', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(0);
    expect(ms!).toBeLessThanOrEqual(5000);
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});
