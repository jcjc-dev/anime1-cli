import { describe, expect, it } from 'vitest';
import {
  filterByYearSeason,
  listSeasons,
  listYears,
  parseAnimeRow,
  searchByTitle,
  splitCompound,
} from '../src/filter.js';
import type { Anime } from '../src/types.js';

function row(over: unknown[]): Anime {
  const parsed = parseAnimeRow(over);
  if (!parsed) throw new Error('row failed to parse');
  return parsed;
}

describe('parseAnimeRow', () => {
  it('parses a standard row', () => {
    const a = row([6, 'LoveLive! Sunshine!!', '1-13', '2016', '夏', '澄空&華盟']);
    expect(a.catId).toBe(6);
    expect(a.title).toBe('LoveLive! Sunshine!!');
    expect(a.episodes).toBe('1-13');
    expect(a.years).toEqual(['2016']);
    expect(a.seasons).toEqual(['夏']);
    expect(a.subGroup).toBe('澄空&華盟');
    expect(a.adult).toBe(false);
  });

  it('splits compound year and season values', () => {
    const a = row([10, 'Long Runner', '連載中(99)', '2025/2026', '夏/冬', '']);
    expect(a.years).toEqual(['2025', '2026']);
    expect(a.seasons).toEqual(['夏', '冬']);
  });

  it('extracts years embedded inside the season field', () => {
    const a = row([11, 'Embedded', '1-50', '', '2025冬/2026春', '']);
    expect(a.years).toEqual(['2025', '2026']);
    expect(a.seasons).toEqual(['春', '冬']);
  });

  it('flags rows without a valid category id as adult/non-downloadable', () => {
    const a = row([0, 'Adult Title', '1', '2024', '春', '']);
    expect(a.adult).toBe(true);
    expect(a.catId).toBe(0);
  });

  it('returns null for malformed rows', () => {
    expect(parseAnimeRow([])).toBeNull();
    expect(parseAnimeRow([1, ''])).toBeNull();
  });
});

describe('splitCompound', () => {
  it('splits and trims on slash', () => {
    expect(splitCompound('夏 / 冬')).toEqual(['夏', '冬']);
    expect(splitCompound('2025')).toEqual(['2025']);
    expect(splitCompound('')).toEqual([]);
  });
});

describe('listYears', () => {
  it('returns unique years newest first and ignores adult rows', () => {
    const animes = [
      row([1, 'A', '1', '2016', '夏', '']),
      row([2, 'B', '1', '2025', '春', '']),
      row([3, 'C', '1', '2020/2021', '冬', '']),
      row([0, 'Adult', '1', '2099', '春', '']),
    ];
    expect(listYears(animes)).toEqual(['2025', '2021', '2020', '2016']);
  });
});

describe('listSeasons', () => {
  it('orders seasons latest-first within a year', () => {
    const animes = [
      row([1, 'A', '1', '2025', '冬', '']),
      row([2, 'B', '1', '2025', '秋', '']),
      row([3, 'C', '1', '2025', '春', '']),
      row([4, 'D', '1', '2025', '夏', '']),
    ];
    expect(listSeasons(animes, '2025')).toEqual(['秋', '夏', '春', '冬']);
  });
});

describe('filterByYearSeason', () => {
  const animes = [
    row([1, 'Beta', '1', '2025', '夏', '']),
    row([2, 'Alpha', '1', '2025', '夏', '']),
    row([3, 'Gamma', '1', '2025', '冬', '']),
  ];

  it('returns matching titles sorted alphabetically', () => {
    const result = filterByYearSeason(animes, '2025', '夏').map((a) => a.title);
    expect(result).toEqual(['Alpha', 'Beta']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterByYearSeason(animes, '2024', '夏')).toEqual([]);
  });
});

describe('searchByTitle', () => {
  const animes = [
    row([1, 'Frieren', '1', '2023', '秋', '']),
    row([2, 'Spy Family', '1', '2022', '春', '']),
  ];

  it('matches case-insensitively on title substring', () => {
    expect(searchByTitle(animes, 'spy').map((a) => a.title)).toEqual(['Spy Family']);
  });

  it('returns all when query is empty', () => {
    expect(searchByTitle(animes, '   ')).toHaveLength(2);
  });
});
