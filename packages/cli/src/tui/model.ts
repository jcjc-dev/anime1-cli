// Pure browse-model for the columnar TUI. No terminal I/O, no network: every
// function maps a state to a new state (plus an optional action for the shell to
// perform). Fully unit-testable. The catalogue is in memory already, so only the
// episode pane needs an async load, which the shell triggers via the
// 'load-episodes' action.

import type { Anime, Episode } from 'anime1-core';
import {
  filterByYearSeason,
  listSeasons,
  listYears,
  searchByTitle,
} from 'anime1-core';

export const PANES = ['years', 'seasons', 'series', 'episodes'] as const;
export type PaneKind = (typeof PANES)[number];
export const PANE_COUNT = PANES.length;

export type ActionResult =
  | { type: 'none' }
  | { type: 'load-episodes'; series: Anime }
  | { type: 'download'; series: Anime; episodes: Episode[]; outDir: string }
  | { type: 'queue'; series: Anime; episodes: Episode[]; outDir: string }
  | { type: 'exit' };

export interface BrowseState {
  catalog: Anime[];
  years: string[];
  /** Seasons for the selected year (derived from the catalog). */
  seasons: string[];
  /** Series for the selected year+season, after applying the filter. */
  series: Anime[];
  /** Unfiltered series list, so typing a filter can be undone. */
  seriesAll: Anime[];
  /** Episodes for the selected series (loaded async by the shell). */
  episodes: Episode[];
  active: number;
  yearCursor: number;
  seasonCursor: number;
  seriesCursor: number;
  episodeCursor: number;
  selectedYear: string | null;
  selectedSeason: string | null;
  selectedSeries: Anime | null;
  selectedEpisodeIndexes: Set<number>;
  episodesLoading: boolean;
  episodesError: string | null;
  filter: string;
  outDir: string;
}

export function createBrowseState(catalog: Anime[], outDir: string): BrowseState {
  // The cursor implies selection: the first item of each pane is selected from
  // the start, so the panes are populated immediately from the in-memory catalog.
  const years = listYears(catalog);
  const selectedYear = years[0] ?? null;
  const seasons = derivedSeasons(catalog, selectedYear);
  const selectedSeason = seasons[0] ?? null;
  const series = derivedSeries(catalog, selectedYear, selectedSeason, '');
  return {
    catalog,
    years,
    seasons,
    series: series.filtered,
    seriesAll: series.all,
    episodes: [],
    active: 0,
    yearCursor: 0,
    seasonCursor: 0,
    seriesCursor: 0,
    episodeCursor: 0,
    selectedYear,
    selectedSeason,
    selectedSeries: series.filtered[0] ?? null,
    selectedEpisodeIndexes: new Set(),
    episodesLoading: false,
    episodesError: null,
    filter: '',
    outDir,
  };
}

function derivedSeasons(catalog: Anime[], year: string | null): string[] {
  return year ? listSeasons(catalog, year) : [];
}

function derivedSeries(
  catalog: Anime[],
  year: string | null,
  season: string | null,
  filter: string,
): { all: Anime[]; filtered: Anime[] } {
  const all = year && season ? filterByYearSeason(catalog, year, season) : [];
  return { all, filtered: filter ? searchByTitle(all, filter) : all };
}

/** Clears the episode pane (belongs to a specific series). */
function clearEpisodes(state: BrowseState): BrowseState {
  return {
    ...state,
    episodes: [],
    episodeCursor: 0,
    episodesLoading: false,
    episodesError: null,
    selectedEpisodeIndexes: new Set(),
  };
}

/** The items (and the cursor into them) for a given pane. */
function paneItems(state: BrowseState, pane: number): { items: unknown[]; cursor: number } {
  switch (pane) {
    case 0:
      return { items: state.years, cursor: state.yearCursor };
    case 1:
      return { items: state.seasons, cursor: state.seasonCursor };
    case 2:
      return { items: state.series, cursor: state.seriesCursor };
    default:
      return { items: state.episodes, cursor: state.episodeCursor };
  }
}

function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** True when the active pane's current selection has data to drill into. */
function canEnter(state: BrowseState): boolean {
  switch (state.active) {
    case 0:
      return state.selectedYear !== null;
    case 1:
      return state.selectedSeason !== null;
    case 2:
      return state.selectedSeries !== null;
    default:
      return false; // episodes: Enter toggles a selection, not drill-down.
  }
}

export interface Step {
  state: BrowseState;
  action: ActionResult;
}

function moveInYear(state: BrowseState, delta: number): Step {
  const cursor = clamp(state.yearCursor + delta, state.years.length);
  const year = state.years[cursor] ?? null;
  const next = { ...state, yearCursor: cursor, selectedYear: year };
  next.seasons = derivedSeasons(next.catalog, year);
  next.seasonCursor = 0;
  next.selectedSeason = next.seasons[0] ?? null;
  const series = derivedSeries(next.catalog, year, next.selectedSeason, next.filter);
  next.seriesAll = series.all;
  next.series = series.filtered;
  next.seriesCursor = 0;
  next.selectedSeries = series.filtered[0] ?? null;
  return { state: clearEpisodes(next), action: { type: 'none' } };
}

function moveInSeason(state: BrowseState, delta: number): Step {
  const cursor = clamp(state.seasonCursor + delta, state.seasons.length);
  const season = state.seasons[cursor] ?? null;
  const next = { ...state, seasonCursor: cursor, selectedSeason: season };
  const series = derivedSeries(next.catalog, next.selectedYear, season, next.filter);
  next.seriesAll = series.all;
  next.series = series.filtered;
  next.seriesCursor = 0;
  next.selectedSeries = series.filtered[0] ?? null;
  return { state: clearEpisodes(next), action: { type: 'none' } };
}

function moveInSeries(state: BrowseState, delta: number): Step {
  const cursor = clamp(state.seriesCursor + delta, state.series.length);
  const series = state.series[cursor] ?? null;
  const next = { ...state, seriesCursor: cursor, selectedSeries: series };
  return {
    state: clearEpisodes(next),
    action: series ? { type: 'load-episodes', series } : { type: 'none' },
  };
}

/**
 * Moves the active pane's cursor by `delta` items (negative = up). For the
 * browse panes the selection follows and child panes are re-derived; for the
 * episode pane only the cursor moves.
 */
function moveBy(state: BrowseState, delta: number): Step {
  switch (state.active) {
    case 0:
      return moveInYear(state, delta);
    case 1:
      return moveInSeason(state, delta);
    case 2:
      return moveInSeries(state, delta);
    default:
      return {
        state: { ...state, episodeCursor: clamp(state.episodeCursor + delta, state.episodes.length) },
        action: { type: 'none' },
      };
  }
}

export function moveUp(state: BrowseState): Step {
  return moveBy(state, -1);
}

export function moveDown(state: BrowseState): Step {
  return moveBy(state, 1);
}

/** Moves the active pane cursor by roughly a page (for PgUp/PgDn). */
export function pageUp(state: BrowseState, pageSize: number): Step {
  return moveBy(state, -Math.max(1, Math.floor(pageSize)));
}

export function pageDown(state: BrowseState, pageSize: number): Step {
  return moveBy(state, Math.max(1, Math.floor(pageSize)));
}

/** Jumps to the first item of the active pane. */
export function goHome(state: BrowseState): Step {
  return moveBy(state, -1e9);
}

/** Jumps to the last item of the active pane. */
export function goEnd(state: BrowseState): Step {
  return moveBy(state, 1e9);
}

/**
 * Moves the active pane one column left. At the leftmost column this signals the
 * shell to exit the TUI (there is nothing further back).
 */
export function moveLeft(state: BrowseState): Step {
  if (state.active === 0) return { state, action: { type: 'exit' } };
  return { state: { ...state, active: state.active - 1 }, action: { type: 'none' } };
}

/**
 * Moves the active pane one column right ("enters" the next level). Entering the
 * episode pane from a series triggers the async episode load.
 */
export function moveRight(state: BrowseState): Step {
  if (state.active >= PANE_COUNT - 1) return { state, action: { type: 'none' } };
  if (!canEnter(state)) return { state, action: { type: 'none' } };
  const next = { ...state, active: state.active + 1 };
  if (next.active === 3 && next.selectedSeries) {
    return { state: next, action: { type: 'load-episodes', series: next.selectedSeries } };
  }
  return { state: next, action: { type: 'none' } };
}

/** Toggles an episode in the current series selection. */
export function toggleEpisode(state: BrowseState, index: number): Step {
  const next = {
    ...state,
    selectedEpisodeIndexes: new Set(state.selectedEpisodeIndexes),
  };
  if (next.selectedEpisodeIndexes.has(index)) next.selectedEpisodeIndexes.delete(index);
  else next.selectedEpisodeIndexes.add(index);
  return { state: next, action: { type: 'none' } };
}

/**
 * Selects all episodes, or unselects all when every episode is already selected.
 * A handy way to grab (or un-grab) an entire series in one keypress.
 */
export function toggleSelectAll(state: BrowseState): Step {
  const next = { ...state, selectedEpisodeIndexes: new Set<number>() };
  const count = state.episodes.length;
  const allSelected = count > 0 && state.selectedEpisodeIndexes.size === count;
  if (!allSelected) {
    for (let i = 0; i < count; i++) next.selectedEpisodeIndexes.add(i);
  }
  return { state: next, action: { type: 'none' } };
}

/** Rebuilds the (filtered) series list from the typed filter text. */
function applyFilter(state: BrowseState, filter: string): BrowseState {
  const next = { ...state, filter };
  const series = derivedSeries(next.catalog, next.selectedYear, next.selectedSeason, filter);
  next.seriesAll = series.all;
  next.series = series.filtered;
  next.seriesCursor = clamp(next.seriesCursor, next.series.length);
  if (next.selectedSeries && !next.series.includes(next.selectedSeries)) {
    next.selectedSeries = next.series[next.seriesCursor] ?? null;
  }
  return next;
}

export function typeFilter(state: BrowseState, ch: string): Step {
  if (state.active !== 2) return { state, action: { type: 'none' } };
  return { state: applyFilter(state, `${state.filter}${ch}`), action: { type: 'none' } };
}

export function backspaceFilter(state: BrowseState): Step {
  if (state.active !== 2) return { state, action: { type: 'none' } };
  return { state: applyFilter(state, state.filter.slice(0, -1)), action: { type: 'none' } };
}

/**
 * Confirms the current selection for download. The selected indexes (or all
 * episodes, when none are selected) are returned to the shell to download.
 */
export function confirmDownload(state: BrowseState): Step {
  const series = state.selectedSeries;
  if (!series || state.episodes.length === 0) return { state, action: { type: 'none' } };
  const chosen =
    state.selectedEpisodeIndexes.size > 0
      ? state.episodes.filter((_, i) => state.selectedEpisodeIndexes.has(i))
      : state.episodes;
  return { state, action: { type: 'download', series, episodes: chosen, outDir: state.outDir } };
}

/**
 * Queues the current selection for background download (the TUI keeps running).
 * Behaves like {@link confirmDownload} but returns a 'queue' action instead of
 * 'download'.
 */
export function queueDownload(state: BrowseState): Step {
  const series = state.selectedSeries;
  if (!series || state.episodes.length === 0) return { state, action: { type: 'none' } };
  const chosen =
    state.selectedEpisodeIndexes.size > 0
      ? state.episodes.filter((_, i) => state.selectedEpisodeIndexes.has(i))
      : state.episodes;
  return { state, action: { type: 'queue', series, episodes: chosen, outDir: state.outDir } };
}

/** Records the result of an async episode load into the state. */
export function setEpisodes(
  state: BrowseState,
  episodes: Episode[],
  error: string | null,
): BrowseState {
  return {
    ...state,
    episodes,
    episodesLoading: false,
    episodesError: error,
    episodeCursor: clamp(state.episodeCursor, episodes.length),
    selectedEpisodeIndexes: new Set(),
  };
}

export function beginEpisodeLoad(state: BrowseState, series: Anime): BrowseState {
  if (state.selectedSeries?.catId !== series.catId) {
    return {
      ...state,
      selectedSeries: series,
      episodes: [],
      episodesLoading: true,
      episodesError: null,
      selectedEpisodeIndexes: new Set(),
    };
  }
  return { ...state, episodesLoading: true, episodesError: null };
}

/** Items + cursor for the active pane (used by the renderer). */
export function activePane(state: BrowseState): { kind: PaneKind; items: unknown[]; cursor: number } {
  const pane = state.active;
  const { items, cursor } = paneItems(state, pane);
  return { kind: PANES[pane], items, cursor };
}
