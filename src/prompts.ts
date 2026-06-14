import { checkbox, input, search, select } from '@inquirer/prompts';
import { SEASON_EN } from './constants.js';
import { listSeasons, listYears } from './filter.js';
import type { Anime, Episode } from './types.js';

export async function pickYear(animes: Anime[]): Promise<string> {
  const years = listYears(animes);
  if (years.length === 0) throw new Error('No years available in the catalog.');
  return select({
    message: 'Select a year (latest first):',
    choices: years.map((year, idx) => ({
      name: idx === 0 ? `${year}  (latest)` : year,
      value: year,
    })),
    pageSize: 12,
  });
}

export async function pickSeason(animes: Anime[], year: string): Promise<string> {
  const seasons = listSeasons(animes, year);
  if (seasons.length === 0) throw new Error(`No seasons available for ${year}.`);
  return select({
    message: `Select a season in ${year} (latest first):`,
    choices: seasons.map((season) => ({
      name: `${season}  ${SEASON_EN[season] ?? ''}`.trim(),
      value: season,
    })),
  });
}

export async function pickSeries(list: Anime[]): Promise<Anime> {
  if (list.length === 0) throw new Error('No downloadable series found for that year/season.');
  return search<Anime>({
    message: `Select a series (${list.length} found — type to filter):`,
    source: async (term) => {
      const query = (term ?? '').toLowerCase();
      return list
        .filter((anime) => !query || anime.title.toLowerCase().includes(query))
        .map((anime) => ({
          name: `${anime.title}  —  ${anime.episodes}${anime.subGroup ? `  [${anime.subGroup}]` : ''}`,
          value: anime,
        }));
    },
  });
}

export async function pickEpisodes(episodes: Episode[]): Promise<Episode[]> {
  if (episodes.length <= 1) return episodes;
  const mode = await select({
    message: `This series has ${episodes.length} episode(s). What would you like to download?`,
    choices: [
      { name: 'All episodes', value: 'all' },
      { name: 'Choose specific episodes', value: 'choose' },
    ],
  });
  if (mode === 'all') return episodes;
  return checkbox<Episode>({
    message: 'Select episodes (space to toggle, a = all, i = invert, enter to confirm):',
    choices: episodes.map((episode) => ({ name: episode.title, value: episode })),
    pageSize: 15,
    required: true,
    theme: {
      icon: {
        checked: '[x]',
        unchecked: '[ ]',
        cursor: '❯',
      },
    },
  });
}

export async function askOutputDir(defaultDir: string): Promise<string> {
  return input({ message: 'Output directory:', default: defaultDir });
}
