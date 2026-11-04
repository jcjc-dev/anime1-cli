// Pure column renderer for the TUI. Produces plain-text screen rows plus, for
// each row, the character ranges to highlight (reverse-video) so the shell can
// highlight exactly the selected cell (column x row) rather than a whole line.
// Height-aware: each pane is a scrollable viewport whose window tracks its own
// cursor. A breadcrumb and a highlighted active-column header make it obvious
// which section you are in. No I/O.

import type { Anime, Episode } from 'anime1-core';
import { SEASON_EN } from 'anime1-core';
import { charWidth, displayWidth, renderProgress, truncateToWidth } from '../ui.js';
import type { Job } from '../downloader.js';
import type { BrowseState, PaneKind } from './model.js';

export interface RenderContext {
  state: BrowseState;
  width: number;
  height: number;
  /** Transient status line shown in the title (e.g. a download notice). */
  message?: string;
  /** Live download-queue snapshot to render in a bottom panel (browse) or as its own view. */
  jobs?: Job[];
  /** Whether to show the full queue view (Tab toggles between browse and queue). */
  mode?: 'browse' | 'queue';
  /** Cursor into the queue list when mode === 'queue'. */
  queueCursor?: number;
  /** Current wall-clock time (ms) — drives the marquee animation for overflow titles. */
  now?: number;
}

/** A character range (in the row's plain text) to render in reverse video. */
export interface HighlightRange {
  start: number;
  end: number;
}

export interface ScreenRow {
  text: string;
  /** Character ranges to highlight — usually just the selected cell, never the whole line. */
  ranges?: HighlightRange[];
  /** Visual style applied by the shell (title bar, footer, header, dimmed content). */
  style?: 'title' | 'header' | 'footer' | 'dim';
}

const PANE_HEADERS: Record<PaneKind, string> = {
  years: 'Years',
  seasons: 'Seasons',
  series: 'Series',
  episodes: 'Episodes',
};

const SPACING = 2;
const MARQUEE_TICK_MS = 130; // columns of scroll per second
const MARQUEE_GAP = 3; // columns of blank before the overflow title loops back

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
  // Truncated text can be narrower than `width` (the next glyph wouldn't fit);
  // pad it back up so every cell is exactly `width` columns and the columns to
  // its right never shift (this was the episodes-alignment bug).
  const t = truncateToWidth(text, width);
  return t + ' '.repeat(width - displayWidth(t));
}

/** Extracts `width` display columns from `s` starting at display column `startCol`. */
function sliceColumns(s: string, startCol: number, width: number): string {
  let col = 0;
  let i = 0;
  while (i < s.length && col < startCol) {
    col += charWidth(s.codePointAt(i)!);
    i++;
  }
  let out = '';
  let taken = 0;
  while (i < s.length && taken < width) {
    const cw = charWidth(s.codePointAt(i)!);
    if (taken + cw > width) break;
    out += s[i];
    taken += cw;
    i++;
  }
  return out + ' '.repeat(width - taken);
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

/** A single column cell: padded text plus whether it should be highlighted. */
interface Cell {
  text: string;
  highlight: boolean;
}

/** Assembles a row from its cells and records per-cell highlight ranges. */
function assembleRow(cells: Cell[]): ScreenRow {
  let text = '';
  const ranges: HighlightRange[] = [];
  for (const cell of cells) {
    const start = text.length;
    text += cell.text;
    if (cell.highlight) ranges.push({ start, end: text.length });
  }
  return ranges.length > 0 ? { text, ranges } : { text };
}

function cellAt(
  window: { start: number; end: number; visible: string[] },
  row: number,
  cursor: number,
  isActive: boolean,
  width: number,
  now?: number,
): Cell {
  const item = window.visible[row];
  if (item === undefined) {
    // Pad empty cells to the full column width so shorter columns never collapse
    // and push later columns into their space.
    return { text: ' '.repeat(width), highlight: false };
  }
  const isCursor = isActive && window.start + row === cursor;
  // Marquee: animate the selected cell when its content overflows the column.
  // A doubled copy makes it loop seamlessly — the text slides out to the left,
  // a small gap passes, then the next copy flows in from the right.
  if (isCursor && now != null && displayWidth(item) > width) {
    const box = item.match(/^\[[ x]\] /); // e.g. "[ ] " / "[x] " checkbox
    if (box) {
      // Keep the checkbox marker fixed; marquee only the title within the rest.
      const prefix = box[0];
      const content = item.slice(prefix.length);
      const inner = width - displayWidth(prefix);
      const ticker = content + ' '.repeat(MARQUEE_GAP) + content;
      const cycle = displayWidth(content) + MARQUEE_GAP;
      const pos = Math.floor((now / MARQUEE_TICK_MS) % cycle);
      return { text: prefix + sliceColumns(ticker, pos, inner), highlight: true };
    }
    const ticker = item + ' '.repeat(MARQUEE_GAP) + item;
    const cycle = displayWidth(item) + MARQUEE_GAP;
    const pos = Math.floor((now / MARQUEE_TICK_MS) % cycle);
    return { text: sliceColumns(ticker, pos, width), highlight: true };
  }
  return { text: padOrTruncate(item, width), highlight: isCursor };
}

function scrollMarkers(window: { start: number; end: number }, length: number): string {
  const above = window.start > 0 ? '▲' : '';
  const below = window.end < length ? '▼' : '';
  return `${above}${below}`;
}

/** Renders the browse view into screen rows (plain text, no ANSI). */
export function renderBrowse(ctx: RenderContext): ScreenRow[] {
  if (ctx.mode === 'queue') return renderQueueView(ctx);
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
  const lengths = [years.length, seasons.length, series.length, episodes.length];

  const rows: ScreenRow[] = [];

  // Title + breadcrumb: makes the current section obvious.
  const crumb: string[] = [];
  if (state.selectedYear) crumb.push(state.selectedYear);
  if (state.selectedSeason) crumb.push(`${state.selectedSeason} ${SEASON_EN[state.selectedSeason] ?? ''}`.trim());
  if (state.selectedSeries) crumb.push(state.selectedSeries.title);
  const crumbText = crumb.length > 0 ? crumb.join(' › ') : 'catalogue';
  const title = `anime1 — ${crumbText}${state.filter ? `  [filter: "${state.filter}"]` : ''}${ctx.message ? `  ${ctx.message}` : ''}`;
  rows.push({ text: padOrTruncate(title, width), style: 'title' });
  rows.push({ text: '─'.repeat(width) });

  // Column header row: styled with its own color (never the selection color) so
  // it stays distinct from the selected cell; the active column is marked with ▸.
  const headerCells = (['years', 'seasons', 'series', 'episodes'] as PaneKind[]).map((kind, i) => {
    const label = `${i === activeColumn ? '▸ ' : ''}${PANE_HEADERS[kind]}${scrollMarkers(windows[i], lengths[i])}`;
    return padOrTruncate(label, colWidth);
  });
  rows.push({ text: headerCells.join(''), style: 'header' });

  // Item rows: each pane is a scrollable viewport window; only the cursor cell
  // (active column, cursor row) is highlighted.
  for (let r = 0; r < pageHeight; r++) {
    const cells = (['years', 'seasons', 'series', 'episodes'] as PaneKind[]).map((_, i) =>
      cellAt(windows[i], r, cursors[i], i === activeColumn, colWidth, ctx.now),
    );
    rows.push(assembleRow(cells));
  }

  // Queue panel.
  if (ctx.jobs && ctx.jobs.length > 0) {
    rows.push({ text: '─'.repeat(width) });
    rows.push({ text: `Downloads (${ctx.jobs.length})`, style: 'dim' });
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
      rows.push({ text: truncateToWidth(line, width), style: 'dim' });
    }
  }

  const picked = selectedCount(state);
  const footer =
    `←/→ move  ↑/↓ select  PgUp/PgDn page  Home/End jump  Enter drill/select  ` +
    `Space toggle  a all/none  r reload  Backspace back  d queue${picked > 0 ? ` (${picked})` : ''}  Tab downloads  q quit`;
  rows.push({ text: '─'.repeat(width) });
  rows.push({ text: padOrTruncate(footer, width), style: 'footer' });
  return rows;
}

/** Renders the standalone Downloads (queue) view, distinct from the browse panes. */
function renderQueueView(ctx: RenderContext): ScreenRow[] {
  const { width, height, jobs = [], queueCursor = 0 } = ctx;
  const rows: ScreenRow[] = [];
  const pageHeight = Math.max(3, Math.floor(height) - 4); // title + sep + footer sep + footer
  const win = windowSlice(jobs, queueCursor, pageHeight);
  const marks = jobs.length > pageHeight ? `${win.start > 0 ? '▲' : ''}${win.end < jobs.length ? '▼' : ''}` : '';
  rows.push({ text: padOrTruncate(`anime1 — Downloads (${jobs.length})${marks}`, width), style: 'title' });
  rows.push({ text: '─'.repeat(width) });

  if (jobs.length === 0) {
    rows.push({ text: padOrTruncate('Queue is empty. Press Tab to browse and queue downloads.', width), style: 'dim' });
  } else {
    for (let r = 0; r < win.visible.length; r++) {
      const job = win.visible[r];
      const icon = job.status === 'queued' ? '○' : job.status === 'downloading' ? '↓' : job.status === 'done' ? '✓' : '✗';
      const progress =
        job.status === 'done'
          ? 'done'
          : job.status === 'error'
            ? (job.error ?? 'failed')
            : job.status === 'downloading'
              ? renderProgress(job.progress.received, job.progress.total)
              : 'queued';
      const active = win.start + r === queueCursor;
      const text = truncateToWidth(`${active ? '▸ ' : '  '}${icon} ${job.seriesTitle} — ${job.episode.title}   ${progress}`, width);
      rows.push(active ? { text, ranges: [{ start: 0, end: text.length }] } : { text });
    }
  }

  rows.push({ text: '─'.repeat(width) });
  rows.push({ text: padOrTruncate('↑/↓ move  x cancel (aborts a downloading job)  Tab browse  q quit', width), style: 'footer' });
  return rows;
}

/** Returns the item under the active pane cursor (used by the shell). */
export function seriesTitle(series: Anime): string {
  return `${series.title}  (${series.episodes})`;
}

export function episodeLabel(episode: Episode): string {
  return episode.title;
}

/**
 * True when the active pane's selected (cursor) cell overflows its column, i.e.
 * a marquee is animating. The shell uses this to run/stop the animation timer.
 */
export function activeMarquee(state: BrowseState, width: number): boolean {
  const colWidth = Math.max(8, Math.floor((width - SPACING * (4 - 1)) / 4));
  const lines = [
    state.years.map((year) => (year === state.selectedYear ? `› ${year}` : year)),
    state.seasons.map((season) => `${season} ${SEASON_EN[season] ?? ''}`.trim()),
    seriesLines(state),
    episodeLines(state),
  ];
  const cursors = [state.yearCursor, state.seasonCursor, state.seriesCursor, state.episodeCursor];
  const item = lines[state.active][cursors[state.active]];
  return item != null && displayWidth(item) > colWidth;
}
