// Pure column renderer for the TUI. Produces plain-text screen rows; the shell
// applies ANSI styling (inverting highlighted rows) when drawing. Height-aware:
// each pane is a scrollable viewport whose window tracks the cursor, so long
// lists never overflow the terminal. A breadcrumb in the title and a highlighted
// active column make it obvious which section you are in. No I/O.

import type { Anime, Episode } from 'anime1-core';
import { SEASON_EN } from 'anime1-core';
import { displayWidth, renderProgress, truncateToWidth } from '../ui.js';
import type { Job } from '../downloader.js';
import type { BrowseState, PaneKind } from './model.js';

export interface RenderContext {
  state: BrowseState;
  width: number;
  height: number;
  /** Transient status line shown in the title (e.g. a download notice). */
  message?: string;
  /** Live download-queue snapshot to render in a bottom panel. */
  jobs?: Job[];
}

export interface ScreenRow {
  text: string;
  /** Highlighted (inverted) when it is the active column's header or cursor. */
  highlight?: boolean;
}

const PANE_HEADERS: Record<PaneKind, string> = {
  years: 'Years',
  seasons: 'Seasons',
  series: 'Series',
  episodes: 'Episodes',
};

const SPACING = 2;

/**
 * How many item rows fit in the browse area for a given terminal height and
 * queue-panel size. Shared with the shell so PgUp/PgDn page by the same amount.
 */
export function computePageHeight(height: number, jobCount: number): number {
  const topReserved = 3; // title + separator + column header
  const bottomReserved = 2; // separator + footer
  const queueRows = jobCount > 0 ? Math.min(jobCount, 8) + 2 : 0;
  return Math.max(3, Math.floor(height) - topReserved - bottomReserved - queueRows);
}

function padOrTruncate(text: string, width: number): string {
  const w = displayWidth(text);
  if (w <= width) return text + ' '.repeat(width - w);
  return truncateToWidth(text, width);
}

/** Computes a centered window of `pageHeight` items around the cursor. */
function windowSlice<T>(
  items: T[],
  cursor: number,
  pageHeight: number,
): { start: number; end: number; visible: T[] } {
  if (items.length === 0) return { start: 0, end: 0, visible: [] };
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(pageHeight / 2), Math.max(0, items.length - pageHeight)),
  );
  const end = Math.min(items.length, start + pageHeight);
  return { start, end, visible: items.slice(start, end) };
}

function episodeLines(state: BrowseState): string[] {
  if (state.episodesLoading) return ['(loading…)'];
  if (state.episodesError) return [`(error: ${state.episodesError})`];
  return state.episodes.map(
    (episode, i) => `${state.selectedEpisodeIndexes.has(i) ? '[x]' : '[ ]'} ${episode.title}`,
  );
}

function seriesLines(state: BrowseState): string[] {
  return state.series.map((anime) => `${anime.title}  ${anime.episodes}`);
}

function selectedCount(state: BrowseState): number {
  return state.selectedEpisodeIndexes.size;
}

/** A per-column cell at a given browse row (empty when out of range). */
interface Cell {
  text: string;
  highlight: boolean;
}

function cellAt(
  window: { start: number; end: number; visible: string[] },
  row: number,
  cursor: number,
  isActive: boolean,
  width: number,
): Cell {
  const item = window.visible[row];
  if (item === undefined) {
    // Pad empty cells to the full column width so shorter columns never collapse
    // and push later columns into their space (keeps each column aligned and
    // paginating independently).
    return { text: ' '.repeat(width), highlight: false };
  }
  return {
    text: padOrTruncate(item, width),
    highlight: isActive && window.start + row === cursor,
  };
}

function scrollMarkers(window: { start: number; end: number }, length: number): string {
  const above = window.start > 0 ? '▲' : '';
  const below = window.end < length ? '▼' : '';
  return `${above}${below}`;
}

/** Renders the browse view into screen rows (plain text, no ANSI). */
export function renderBrowse(ctx: RenderContext): ScreenRow[] {
  const { state, width } = ctx;
  const colWidth = Math.max(8, Math.floor((width - SPACING * (4 - 1)) / 4));
  const pageHeight = computePageHeight(ctx.height, ctx.jobs?.length ?? 0);

  const years = state.years.map((year) => (year === state.selectedYear ? `› ${year}` : year));
  const seasons = state.seasons.map((season) => `${season} ${SEASON_EN[season] ?? ''}`.trim());
  const series = seriesLines(state);
  const episodes = episodeLines(state);

  const windows = [
    windowSlice(years, state.yearCursor, pageHeight),
    windowSlice(seasons, state.seasonCursor, pageHeight),
    windowSlice(series, state.seriesCursor, pageHeight),
    windowSlice(episodes, state.episodeCursor, pageHeight),
  ];
  const cursors = [state.yearCursor, state.seasonCursor, state.seriesCursor, state.episodeCursor];
  const activeColumn = state.active;

  const rows: ScreenRow[] = [];

  // Title + breadcrumb: makes the current section obvious.
  const crumb: string[] = [];
  if (state.selectedYear) crumb.push(state.selectedYear);
  if (state.selectedSeason) crumb.push(`${state.selectedSeason} ${SEASON_EN[state.selectedSeason] ?? ''}`.trim());
  if (state.selectedSeries) crumb.push(state.selectedSeries.title);
  const crumbText = crumb.length > 0 ? crumb.join(' › ') : 'catalogue';
  const title = `anime1 — ${crumbText}${state.filter ? `  [filter: "${state.filter}"]` : ''}${ctx.message ? `  ${ctx.message}` : ''}`;
  rows.push({ text: truncateToWidth(title, width) });
  rows.push({ text: '─'.repeat(width) });

  // Column header row: the active column is marked with ▸ and highlighted;
  // ▲/▼ show whether that column can scroll further up/down.
  const lengths = [years.length, seasons.length, series.length, episodes.length];
  const headerCells = (['years', 'seasons', 'series', 'episodes'] as PaneKind[]).map((kind, i) => {
    const label = `${i === activeColumn ? '▸ ' : ''}${PANE_HEADERS[kind]}${scrollMarkers(windows[i], lengths[i])}`;
    return padOrTruncate(label, colWidth);
  });
  rows.push({ text: headerCells.join(''), highlight: true });

  // Item rows: each pane is a scrollable viewport window.
  for (let r = 0; r < pageHeight; r++) {
    const cells = (['years', 'seasons', 'series', 'episodes'] as PaneKind[]).map((_, i) =>
      cellAt(windows[i], r, cursors[i], i === activeColumn, colWidth),
    );
    const text = cells.map((c) => c.text).join('');
    const highlight = cells.some((c) => c.highlight);
    rows.push({ text, highlight: highlight || undefined });
  }

  // Queue panel.
  if (ctx.jobs && ctx.jobs.length > 0) {
    rows.push({ text: '─'.repeat(width) });
    rows.push({ text: `Downloads (${ctx.jobs.length})` });
    for (const job of ctx.jobs.slice(0, 8)) {
      const icon = job.status === 'queued' ? '○' : job.status === 'downloading' ? '↓' : job.status === 'done' ? '✓' : '✗';
      const progress =
        job.status === 'done'
          ? 'done'
          : job.status === 'error'
            ? (job.error ?? 'failed')
            : job.status === 'downloading'
              ? renderProgress(job.progress.received, job.progress.total)
              : 'queued';
      const line = `${icon} ${job.seriesTitle} — ${job.episode.title}  ${progress}`;
      rows.push({ text: truncateToWidth(line, width) });
    }
  }

  const picked = selectedCount(state);
  const footer =
    `←/→ move  ↑/↓ select  PgUp/PgDn page  Home/End jump  Enter drill/select  ` +
    `Space toggle  Backspace back  d queue${picked > 0 ? ` (${picked})` : ''}  q quit`;
  rows.push({ text: '─'.repeat(width) });
  rows.push({ text: truncateToWidth(footer, width) });
  return rows;
}

/** Returns the item under the active pane's cursor (used by the shell). */
export function seriesTitle(series: Anime): string {
  return `${series.title}  (${series.episodes})`;
}

export function episodeLabel(episode: Episode): string {
  return episode.title;
}
