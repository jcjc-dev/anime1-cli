import { describe, expect, it } from 'vitest';
import type { Anime, Episode } from 'anime1-core';
import {
  backspaceFilter,
  beginEpisodeLoad,
  confirmDownload,
  createBrowseState,
  goEnd,
  goHome,
  moveDown,
  moveLeft,
  moveRight,
  pageDown,
  pageUp,
  queueDownload,
  replaceCatalog,
  setEpisodes,
  toggleEpisode,
  toggleSelectAll,
  typeFilter,
} from '../src/tui/model.js';
import type { ActionResult } from '../src/tui/model.js';

const anime = (catId: number, title: string, year: string, season: string, episodes: string): Anime => ({
  catId,
  title,
  episodes,
  years: [year],
  seasons: [season],
  subGroup: '',
  adult: false,
  rawYear: year,
  rawSeason: season,
});

const catalog: Anime[] = [
  anime(1, 'Alpha', '2025', '夏', '1-12'),
  anime(2, 'Beta', '2025', '夏', '1-12'),
  anime(3, 'Gamma', '2025', '冬', '1-13'),
  anime(4, 'Delta', '2024', '夏', '1-6'),
];

const ep = (title: string, number: number): Episode => ({ title, number, apiReq: `tok${number}` });
const eps: Episode[] = [ep('Alpha [1]', 1), ep('Alpha [2]', 2), ep('Alpha [3]', 3)];

/** Drives the model to the episodes pane (Alpha is pre-selected as series[0]). */
function reachEpisodes() {
  let s = createBrowseState(catalog, './downloads');
  s = moveRight(s).state; // years -> seasons
  s = moveRight(s).state; // seasons -> series
  const step = moveRight(s); // series -> episodes (loads Alpha)
  return { state: setEpisodes(step.state, eps, null), action: step.action };
}

describe('createBrowseState', () => {
  it('lists years newest first, pre-selecting the first item of each pane', () => {
    const s = createBrowseState(catalog, './x');
    expect(s.years).toEqual(['2025', '2024']);
    expect(s.active).toBe(0);
    expect(s.selectedYear).toBe('2025');
    expect(s.selectedSeason).toBe('夏');
    expect(s.selectedSeries?.title).toBe('Alpha');
    expect(s.seasons).toEqual(['夏', '冬']);
  });

  it('handles an empty catalog without selecting anything', () => {
    const s = createBrowseState([], './x');
    expect(s.years).toEqual([]);
    expect(s.selectedYear).toBeNull();
    expect(s.selectedSeries).toBeNull();
  });
});

describe('drill-down navigation', () => {
  it('moving down a year repopulates the season and series panes', () => {
    let s = createBrowseState(catalog, './x');
    s = moveDown(s).state; // years cursor -> 2024
    expect(s.selectedYear).toBe('2024');
    expect(s.seasons).toEqual(['夏']);
    expect(s.selectedSeason).toBe('夏');
    expect(s.series.map((a) => a.title)).toEqual(['Delta']);
  });

  it('moves right through the panes to the series pane', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state;
    expect(s.active).toBe(1);
    s = moveRight(s).state;
    expect(s.active).toBe(2);
  });

  it('entering the episode pane requests a load for the selected series', () => {
    const { action } = reachEpisodes();
    expect(action.type).toBe('load-episodes');
    if (action.type === 'load-episodes') expect(action.series.title).toBe('Alpha');
  });

  it('selecting a series on the series pane requests an episode load', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state; // seasons
    s = moveRight(s).state; // series
    const step = moveDown(s); // series cursor -> Beta
    expect(step.action.type).toBe('load-episodes');
    if (step.action.type === 'load-episodes') expect(step.action.series.title).toBe('Beta');
  });

  it('does not move right when there is nothing selected', () => {
    const s = createBrowseState([], './x');
    const step = moveRight(s);
    expect(step.state.active).toBe(0);
    expect(step.action.type).toBe('none');
  });
});

describe('going back', () => {
  it('moves left one pane', () => {
    const { state } = reachEpisodes();
    const step = moveLeft(state);
    expect(step.state.active).toBe(2);
    expect(step.action.type).toBe('none');
  });

  it('exits when pressing left on the leftmost pane', () => {
    const s = createBrowseState(catalog, './x');
    const step = moveLeft(s);
    expect(step.action.type).toBe('exit');
  });
});

describe('episode selection and download', () => {
  it('toggles an episode selection', () => {
    const { state } = reachEpisodes();
    let s = toggleEpisode(state, 0).state;
    expect(s.selectedEpisodeIndexes.has(0)).toBe(true);
    s = toggleEpisode(s, 0).state;
    expect(s.selectedEpisodeIndexes.has(0)).toBe(false);
  });

  it('confirmDownload returns only the selected episodes', () => {
    const { state } = reachEpisodes();
    let s = toggleEpisode(state, 0).state;
    s = toggleEpisode(s, 2).state;
    const step = confirmDownload(s);
    expect(step.action.type).toBe('download');
    if (step.action.type === 'download') {
      expect(step.action.episodes.map((e) => e.number)).toEqual([1, 3]);
      expect(step.action.series.title).toBe('Alpha');
    }
  });

  it('confirmDownload with no selection downloads every episode', () => {
    const { state } = reachEpisodes();
    const step = confirmDownload(state);
    if (step.action.type === 'download') {
      expect(step.action.episodes).toHaveLength(3);
    }
  });

  it('confirmDownload with no loaded episodes does nothing', () => {
    const s = createBrowseState(catalog, './x');
    expect(s.episodes.length).toBe(0);
    const step = confirmDownload(s);
    expect(step.action.type).toBe('none');
  });
});

describe('series filter typing', () => {
  it('filters the series pane and only there', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state;
    s = moveRight(s).state; // series pane (active 2)
    const step = typeFilter(s, 'b');
    expect(step.state.series.map((a) => a.title)).toEqual(['Beta']);
    expect(step.state.filter).toBe('b');
  });

  it('backspace removes a filter character', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state;
    s = moveRight(s).state;
    s = typeFilter(s, 'b').state;
    const step = backspaceFilter(s);
    expect(step.state.filter).toBe('');
    expect(step.state.series.map((a) => a.title)).toEqual(['Alpha', 'Beta']);
  });

  it('typing on a non-series pane is ignored', () => {
    const s = createBrowseState(catalog, './x'); // active 0
    const step = typeFilter(s, 'b');
    expect(step.state.filter).toBe('');
  });
});

describe('setEpisodes', () => {
  it('records episodes and clears the selection', () => {
    const { state } = reachEpisodes();
    const s = setEpisodes(state, eps, null);
    expect(s.episodes).toHaveLength(3);
    expect(s.episodesLoading).toBe(false);
    expect(s.episodesError).toBeNull();
    expect(s.selectedEpisodeIndexes.size).toBe(0);
  });

  it('records an error state', () => {
    const { state } = reachEpisodes();
    const s = setEpisodes(state, [], 'boom');
    expect(s.episodesError).toBe('boom');
  });
});

describe('action shape sanity', () => {
  it('produced download actions carry the outDir', () => {
    const { state } = reachEpisodes();
    const step = confirmDownload(state) as { action: Extract<ActionResult, { type: 'download' }> };
    expect(step.action.outDir).toBe('./downloads');
  });
});

describe('queueDownload', () => {
  it('returns a queue action with the chosen episodes', () => {
    const { state } = reachEpisodes();
    let s = toggleEpisode(state, 0).state;
    s = toggleEpisode(s, 2).state;
    const step = queueDownload(s);
    expect(step.action.type).toBe('queue');
    if (step.action.type === 'queue') {
      expect(step.action.episodes.map((e) => e.number)).toEqual([1, 3]);
      expect(step.action.series.title).toBe('Alpha');
      expect(step.action.outDir).toBe('./downloads');
    }
  });

  it('returns no action when there are no episodes loaded', () => {
    const s = createBrowseState(catalog, './x');
    const step = queueDownload(s);
    expect(step.action.type).toBe('none');
  });
});

describe('paging and jumping', () => {
  it('Home/End jump to the first/last item of the active pane', () => {
    let s = createBrowseState(catalog, './x'); // years: 2025, 2024, cursor 0
    expect(goEnd(s).state.selectedYear).toBe('2024');
    expect(goEnd(s).state.yearCursor).toBe(1);
    const back = goEnd(s).state;
    expect(goHome(back).state.yearCursor).toBe(0);
    expect(goHome(back).state.selectedYear).toBe('2025');
  });

  it('PgDn/PgUp move the cursor by a page, clamped to bounds', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state; // seasons
    s = moveRight(s).state; // series pane, series = [Alpha, Beta], cursor 0
    expect(pageDown(s, 5).state.seriesCursor).toBe(1);
    expect(pageUp(s, 5).state.seriesCursor).toBe(0);
  });

  it('PgUp at the top stays at the top', () => {
    let s = createBrowseState(catalog, './x');
    s = moveRight(s).state;
    s = moveRight(s).state;
    expect(pageUp(s, 3).state.seriesCursor).toBe(0);
  });
});

describe('toggleSelectAll', () => {
  it('selects every episode when none are selected', () => {
    const { state } = reachEpisodes();
    const next = toggleSelectAll(state).state;
    expect(next.selectedEpisodeIndexes.size).toBe(3);
  });

  it('selects the rest when only some are selected', () => {
    const { state } = reachEpisodes();
    let s = toggleEpisode(state, 0).state;
    const next = toggleSelectAll(s).state;
    expect(next.selectedEpisodeIndexes.size).toBe(3);
  });

  it('unselects everything when all are already selected', () => {
    const { state } = reachEpisodes();
    const all = toggleSelectAll(state).state;
    const next = toggleSelectAll(all).state;
    expect(next.selectedEpisodeIndexes.size).toBe(0);
  });
});

describe('replaceCatalog', () => {
  it('keeps selections that still exist and resets episodes', () => {
    const s = createBrowseState(catalog, './x'); // 2025 / 夏 / Alpha selected
    const newCatalog = catalog.filter((a) => a.title !== 'Alpha');
    const next = replaceCatalog(s, newCatalog);
    expect(next.catalog).toBe(newCatalog);
    expect(next.selectedYear).toBe('2025');
    expect(next.selectedSeason).toBe('夏');
    expect(next.series.map((a) => a.title)).toEqual(['Beta']);
    expect(next.selectedSeries?.title).toBe('Beta'); // falls back to first
    expect(next.episodes).toEqual([]);
    expect(next.episodesLoading).toBe(false);
  });

  it('keeps the selected series when it still exists', () => {
    const s = createBrowseState(catalog, './x');
    const next = replaceCatalog(s, catalog);
    expect(next.selectedSeries?.title).toBe('Alpha');
  });

  it('drops a selection that no longer exists in the refreshed catalogue', () => {
    const s = createBrowseState(catalog, './x');
    const empty = replaceCatalog(s, catalog.filter((a) => a.title !== 'Alpha' && a.title !== 'Beta'));
    expect(empty.selectedSeries?.title).toBe('Gamma'); // 2025 winter fallback
  });
});

describe('first-series episode load (regression)', () => {
  it('entering episodes for the pre-selected first series reliably applies episodes', () => {
    let s = createBrowseState(catalog, './x'); // Alpha pre-selected
    s = moveRight(s).state; // seasons
    s = moveRight(s).state; // series
    const step = moveRight(s); // -> episodes
    expect(step.action.type).toBe('load-episodes');
    if (step.action.type === 'load-episodes') {
      const loading = beginEpisodeLoad(step.state, step.action.series);
      expect(loading.episodesLoading).toBe(true);
      expect(loading.episodes).toEqual([]); // stale episodes cleared
      const done = setEpisodes(loading, eps, null);
      expect(done.episodes).toHaveLength(3);
      expect(done.episodesLoading).toBe(false);
    }
  });
});
