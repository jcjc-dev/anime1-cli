import { SEASON_ALIAS, SEASON_CHARS, SEASON_ORDER } from './constants.js';
import type { Anime } from './types.js';

/** Normalizes a season input (english alias or chinese character) to a season char. */
export function normalizeSeason(input: string): string {
  const mapped = SEASON_ALIAS[input.trim().toLowerCase()] ?? SEASON_ALIAS[input.trim()];
  if (!mapped) {
    throw new Error(`Unknown season "${input}". Use spring|summer|autumn|winter or 春/夏/秋/冬.`);
  }
  return mapped;
}

export function parseAnimeRow(row: unknown[]): Anime | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const title = String(row[1] ?? '').trim();
  if (!title) return null;

  const catIdNum = typeof row[0] === 'number' ? row[0] : Number(row[0]);
  const adult = !catIdNum || Number.isNaN(catIdNum);
  const episodes = String(row[2] ?? '').trim();
  const rawYear = String(row[3] ?? '').trim();
  const rawSeason = String(row[4] ?? '').trim();
  const subGroup = String(row[5] ?? '').trim();

  return {
    catId: adult ? 0 : catIdNum,
    title,
    episodes,
    years: extractYears(`${rawYear}/${rawSeason}`),
    seasons: SEASON_CHARS.filter((s) => rawSeason.includes(s)),
    subGroup,
    adult,
    rawYear,
    rawSeason,
  };
}

function extractYears(value: string): string[] {
  const set = new Set<string>();
  for (const match of value.matchAll(/\d{4}/g)) set.add(match[0]);
  return [...set];
}

export function listYears(animes: Anime[]): string[] {
  const set = new Set<string>();
  for (const anime of animes) {
    if (anime.adult) continue;
    for (const year of anime.years) set.add(year);
  }
  return [...set].sort((a, b) => Number(b) - Number(a));
}

export function listSeasons(animes: Anime[], year: string): string[] {
  const set = new Set<string>();
  for (const anime of animes) {
    if (anime.adult || !anime.years.includes(year)) continue;
    for (const season of anime.seasons) set.add(season);
  }
  return [...set].sort((a, b) => (SEASON_ORDER[b] ?? -1) - (SEASON_ORDER[a] ?? -1));
}

export function filterByYearSeason(animes: Anime[], year: string, season: string): Anime[] {
  return animes
    .filter((anime) => !anime.adult && anime.years.includes(year) && anime.seasons.includes(season))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
}

export function searchByTitle(animes: Anime[], query: string): Anime[] {
  const q = query.trim().toLowerCase();
  if (!q) return animes;
  return animes.filter((anime) => anime.title.toLowerCase().includes(q));
}
