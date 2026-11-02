import { describe, expect, it } from 'vitest';
import type { Anime, Episode } from 'anime1-core';
import {
  createBrowseState,
  moveRight,
  setEpisodes,
  toggleEpisode,
} from '../src/tui/model.js';
import { renderBrowse } from '../src/tui/render.js';

const anime = (catId: number, title: string, year: string, season: string): Anime => ({
  catId,
  title,
  episodes: '1-12',
  years: [year],
  seasons: [season],
  subGroup: '',
  adult: false,
  rawYear: year,
  rawSeason: season,
});

const catalog: Anime[] = [anime(1, 'Alpha', '2025', '夏'), anime(2, 'Beta', '2025', '夏')];
const eps: Episode[] = [
  { title: 'Alpha [1]', number: 1, apiReq: 'a' },
  { title: 'Alpha [2]', number: 2, apiReq: 'b' },
];

function toEpisodes() {
  let s = createBrowseState(catalog, './downloads');
  s = moveRight(s).state; // seasons
  s = moveRight(s).state; // series
  s = moveRight(s).state; // episodes
  return setEpisodes(s, eps, null);
}

describe('renderBrowse', () => {
  it('renders pane headers and the footer', () => {
    const rows = renderBrowse({ state: createBrowseState(catalog, './downloads'), width: 120 });
    const text = rows.map((r) => r.text).join('\n');
    expect(text).toContain('Years');
    expect(text).toContain('Seasons');
    expect(text).toContain('Series');
    expect(text).toContain('Episodes');
    expect(text).toContain('./downloads');
  });

  it('highlights exactly the active cursor row', () => {
    const rows = renderBrowse({ state: createBrowseState(catalog, './downloads'), width: 120 });
    const highlighted = rows.filter((r) => r.highlight);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toContain('2025');
  });

  it('shows the selected year with a marker', () => {
    // The first year (2025) is pre-selected on startup.
    const state = createBrowseState(catalog, './downloads');
    const rows = renderBrowse({ state, width: 120 });
    expect(rows.map((r) => r.text).join('\n')).toContain('› 2025');
  });

  it('marks selected episodes with [x]', () => {
    let state = toEpisodes();
    state = toggleEpisode(state, 0).state;
    const rows = renderBrowse({ state, width: 160 });
    const text = rows.map((r) => r.text).join('\n');
    expect(text).toContain('[x] Alpha [1]');
    expect(text).toContain('[ ] Alpha [2]');
  });

  it('shows a loading placeholder while episodes load', () => {
    const state = { ...toEpisodes(), episodesLoading: true, episodes: [] };
    const rows = renderBrowse({ state, width: 160 });
    expect(rows.map((r) => r.text).join('\n')).toContain('(loading…)');
  });

  it('never produces rows wider than the requested width', () => {
    const rows = renderBrowse({ state: toEpisodes(), width: 80 });
    for (const row of rows) {
      // Rows may contain ANSI-free plain text; strip nothing and just check length.
      expect(row.text.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('renderBrowse queue panel', () => {
  it('renders queued jobs with their status', () => {
    const state = toEpisodes();
    const jobs = [
      {
        id: 2,
        seriesTitle: 'Alpha',
        episode: { title: 'Alpha [2]', number: 2, apiReq: 'b' },
        status: 'downloading',
        progress: { received: 512, total: 1024 },
        outDir: './downloads/Alpha',
      },
      {
        id: 1,
        seriesTitle: 'Alpha',
        episode: { title: 'Alpha [1]', number: 1, apiReq: 'a' },
        status: 'queued',
        progress: { received: 0, total: null },
        outDir: './downloads/Alpha',
      },
    ];
    const rows = renderBrowse({ state, width: 160, jobs });
    const text = rows.map((r) => r.text).join('\n');
    expect(text).toContain('Downloads (2)');
    expect(text).toContain('Alpha — Alpha [2]');
    expect(text).toContain('Alpha — Alpha [1]');
  });

  it('omits the queue panel when there are no jobs', () => {
    const rows = renderBrowse({ state: toEpisodes(), width: 160 });
    const text = rows.map((r) => r.text).join('\n');
    expect(text).not.toContain('Downloads (');
  });
});
