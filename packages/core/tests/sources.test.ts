import { describe, expect, it } from 'vitest';
import {
  ANIME1_ME,
  ANIME1_PW,
  classifyUrl,
  detectSource,
  isCategoryUrl,
  isEpisodeUrl,
} from '../src/sources.js';

describe('detectSource', () => {
  it('recognizes supported hosts, ignoring www and case', () => {
    expect(detectSource('https://anime1.me/12345')).toBe(ANIME1_ME);
    expect(detectSource('https://www.anime1.me/category/x')).toBe(ANIME1_ME);
    expect(detectSource('https://ANIME1.pw/349')).toBe(ANIME1_PW);
  });

  it('returns null for unsupported hosts, schemes, or garbage', () => {
    expect(detectSource('https://anime1.in/1999-hai-zei-wang')).toBeNull();
    expect(detectSource('ftp://anime1.me/1')).toBeNull();
    expect(detectSource('not a url')).toBeNull();
  });
});

describe('isEpisodeUrl', () => {
  it('matches numeric permalinks on supported hosts', () => {
    expect(isEpisodeUrl('https://anime1.me/15651')).toBe(true);
    expect(isEpisodeUrl('https://anime1.pw/349/')).toBe(true);
  });

  it('rejects category and non-numeric paths', () => {
    expect(isEpisodeUrl('https://anime1.me/category/2026/show')).toBe(false);
    expect(isEpisodeUrl('https://anime1.pw/some-slug')).toBe(false);
    expect(isEpisodeUrl('https://anime1.in/12345')).toBe(false);
  });
});

describe('isCategoryUrl', () => {
  it('matches anime1.me /category/ paths', () => {
    expect(isCategoryUrl('https://anime1.me/category/2026%E5%B9%B4%E6%98%A5%E5%AD%A3/show')).toBe(
      true,
    );
    expect(isCategoryUrl('https://anime1.me/category/')).toBe(false);
    expect(isCategoryUrl('https://anime1.me/15651')).toBe(false);
  });

  it('matches anime1.pw category queries and slugs, not episodes or system routes', () => {
    expect(isCategoryUrl('https://anime1.pw/?cat=60')).toBe(true);
    expect(isCategoryUrl('https://anime1.pw/one-piece')).toBe(true);
    expect(isCategoryUrl('https://anime1.pw/349')).toBe(false);
    expect(isCategoryUrl('https://anime1.pw/wp-login')).toBe(false);
    expect(isCategoryUrl('https://anime1.pw/feed')).toBe(false);
  });
});

describe('classifyUrl', () => {
  it('classifies source and kind together', () => {
    expect(classifyUrl('https://anime1.me/15651')).toEqual({ source: ANIME1_ME, kind: 'episode' });
    expect(classifyUrl('https://anime1.me/category/2026/show')).toEqual({
      source: ANIME1_ME,
      kind: 'category',
    });
    expect(classifyUrl('https://anime1.pw/349')).toEqual({ source: ANIME1_PW, kind: 'episode' });
    expect(classifyUrl('https://anime1.pw/?cat=60')).toEqual({
      source: ANIME1_PW,
      kind: 'category',
    });
  });

  it('returns null for unsupported or unclassifiable URLs', () => {
    expect(classifyUrl('https://anime1.in/1999-hai-zei-wang')).toBeNull();
    expect(classifyUrl('https://anime1.me/')).toBeNull();
  });
});
