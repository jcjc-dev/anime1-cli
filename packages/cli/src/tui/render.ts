// Pure column renderer for the TUI. Produces plain-text screen rows; the shell
// applies ANSI styling (inverting the active cursor row) when drawing. No I/O,
// so the layout is fully unit-testable.

import type { Anime, Episode } from 'anime1-core';
import { SEASON_EN } from 'anime1-core';
import { displayWidth, renderProgress, truncateToWidth } from '../ui.js';
import type { Job } from '../downloader.js';
import type { BrowseState, PaneKind } from './model.js';

export interface RenderContext {
  state: BrowseState;
  width: number;
  /** Transient status line shown at the top (e.g. a download notice). */
  message?: string;
  /** Live download-queue snapshot to render in a bottom panel. */
  jobs?: Job[];
}

const JOB_ICON: Record<Job['status'], string> = {
  queued: '○',
  downloading: '↓',
  done: '✓',
  error: '✗',
};

export interface ScreenRow {
  text: string;
  /** True when this row is the active cursor row and should be highlighted. */
  highlight: boolean;
}

const PANE_HEADERS: Record<PaneKind, string> = {
  years: 'Years',
  seasons: 'Seasons',
  series: 'Series',
  episodes: 'Episodes',
};

const SPACING = 2;

function padOrTruncate(text: string, width: number): string {
  const w = displayWidth(text);
  if (w <= width) return text + ' '.repeat(width - w);
  return truncateToWidth(text, width);
}

interface Cell {
  text: string;
  highlight: boolean;
}

function paneColumn(
  kind: PaneKind,
  lines: string[],
  cursor: number,
  isActive: boolean,
  width: number,
): Cell[] {
  const cells: Cell[] = [{ text: padOrTruncate(PANE_HEADERS[kind], width), highlight: false }];
  if (lines.length === 0) {
    cells.push({ text: padOrTruncate('—', width), highlight: false });
    return cells;
  }
  for (let i = 0; i < lines.length; i++) {
    cells.push({
      text: padOrTruncate(lines[i], width),
      highlight: isActive && i === cursor,
    });
  }
  return cells;
}

function episodeLines(state: BrowseState): string[] {
  if (state.episodesLoading) return ['(loading…)'];
  if (state.episodesError) return [`(error: ${state.episodesError})`];
  if (state.episodes.length === 0) return [];
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

/** Renders the browse view into screen rows (plain text, no ANSI). */
export function renderBrowse(ctx: RenderContext): ScreenRow[] {
  const { state, width } = ctx;
  const colWidth = Math.max(8, Math.floor((width - SPACING * (4 - 1)) / 4));

  const years = paneColumn(
    'years',
    state.years.map((year) => (year === state.selectedYear ? `› ${year}` : year)),
    state.yearCursor,
    state.active === 0,
    colWidth,
  );
  const seasons = paneColumn(
    'seasons',
    state.seasons.map((season) => `${season} ${SEASON_EN[season] ?? ''}`.trim()),
    state.seasonCursor,
    state.active === 1,
    colWidth,
  );
  const series = paneColumn('series', seriesLines(state), state.seriesCursor, state.active === 2, colWidth);
  const episodes = paneColumn(
    'episodes',
    episodeLines(state),
    state.episodeCursor,
    state.active === 3,
    colWidth,
  );

  const columns = [years, seasons, series, episodes];
  const height = Math.max(...columns.map((column) => column.length));

  const rows: ScreenRow[] = [];
  const title = `anime1  —  ${state.filter ? `filter: "${state.filter}"  ` : ''}${ctx.message ?? ''}`.trimEnd();
  rows.push({ text: title, highlight: false });
  rows.push({ text: '─'.repeat(width), highlight: false });

  for (let r = 0; r < height; r++) {
    let text = '';
    let highlight = false;
    for (const column of columns) {
      const cell = column[r] ?? { text: '', highlight: false };
      text += cell.text;
      if (cell.highlight) highlight = true;
    }
    rows.push({ text, highlight });
  }

  if (ctx.jobs && ctx.jobs.length > 0) {
    rows.push({ text: '─'.repeat(width), highlight: false });
    rows.push({ text: `Downloads (${ctx.jobs.length})`, highlight: false });
    for (const job of ctx.jobs.slice(0, 8)) {
      const status = JOB_ICON[job.status];
      const progress =
        job.status === 'done'
          ? 'done'
          : job.status === 'error'
            ? job.error ?? 'failed'
            : job.status === 'downloading'
              ? renderProgress(job.progress.received, job.progress.total)
              : 'queued';
      const line = `${status} ${job.seriesTitle} — ${job.episode.title}  ${progress}`;
      rows.push({ text: truncateToWidth(line, width), highlight: false });
    }
  }

  const picked = selectedCount(state);
  const footer =
    `←/→ move  ↑/↓ select  Enter drill/select  Space toggle  Backspace back  ` +
    `d queue${picked > 0 ? ` (${picked})` : ''}  q quit  —  ${state.outDir}`;
  rows.push({ text: '─'.repeat(width), highlight: false });
  rows.push({ text: truncateToWidth(footer, width), highlight: false });
  return rows;
}

export function seriesTitle(series: Anime): string {
  return `${series.title}  (${series.episodes})`;
}

export function episodeLabel(episode: Episode): string {
  return episode.title;
}
