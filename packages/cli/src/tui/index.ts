// Thin terminal-I/O shell around the pure browse model + renderer + the
// background DownloadQueue. Owns raw keypress handling, screen drawing, the
// async episode loads, and the live queue panel. All layout/navigation/queue
// logic lives in model.ts / render.ts / downloader.ts (which are unit-tested).

import { emitKeypressEvents } from 'node:readline';
import type { Anime, Episode, NetOptions } from 'anime1-core';
import { fetchCatalog, fetchEpisodes, sanitizeFilename } from 'anime1-core';
import { resolveSeriesDir } from '../args.js';
import { DownloadQueue } from '../downloader.js';
import {
  backspaceFilter,
  beginEpisodeLoad,
  createBrowseState,
  goEnd,
  goHome,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  pageDown,
  pageUp,
  queueDownload,
  replaceCatalog,
  setEpisodes,
  toggleEpisode,
  toggleSelectAll,
  typeFilter,
} from './model.js';
import type { ActionResult, BrowseState } from './model.js';
import { activeMarquee, computePageHeight, renderBrowse } from './render.js';
import type { ScreenRow } from './render.js';

export interface TuiOptions {
  net: NetOptions;
  connections: number;
  concurrency: number;
  /** Base output directory under which each series gets its own folder. */
  outDir: string;
}

export interface TuiResult {
  action: ActionResult;
  queue: DownloadQueue;
}

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
// Selection highlight (cursor cell): bold black on yellow.
const SELECT_STYLE = `${BOLD}${ESC}[30;43m`;
// Title / breadcrumb bar: bold white on magenta — clearly distinct from selection.
const TITLE_STYLE = `${BOLD}${ESC}[37;45m`;
// Column header row: bold cyan — distinct from the selection and the title bar.
const HEADER_STYLE = `${BOLD}${CYAN}`;
const STYLE: Record<'title' | 'header' | 'footer' | 'dim', string> = {
  title: TITLE_STYLE,
  header: HEADER_STYLE,
  footer: DIM,
  dim: DIM,
};
const ALT_ON = `${ESC}[?1049h`; // enter alternate screen buffer
const ALT_OFF = `${ESC}[?1049l`; // leave alternate screen buffer
const DRAW_INTERVAL_MS = 120;
const EPISODE_TTL_MS = 5 * 60 * 1000; // keep episode lists fresh for 5 minutes

function clamp(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/**
 * Runs the interactive columnar browser with a background download queue. The
 * user browses and queues episodes ('d'); downloads run in the background and
 * are shown in a live bottom panel while browsing continues. Resolves once the
 * user quits ('q'); callers should `await queue.idle()` before exiting.
 */
export async function runTui(catalog: Anime[], options: TuiOptions): Promise<TuiResult> {
  return new Promise((resolve) => {
    let state: BrowseState = createBrowseState(catalog, options.outDir);
    let loadToken = 0;
    let finishing = false;
    let message = '';
    let mode: 'browse' | 'queue' = 'browse';
    let queueCursor = 0;
    let lastDraw = 0;
    let pendingDraw: ReturnType<typeof setTimeout> | null = null;
    let lastRows: ScreenRow[] | null = null; // last rendered frame, for incremental redraw
    let animTimer: ReturnType<typeof setInterval> | null = null; // marquee animation

    // Episode cache keyed by series catId, so re-entering a pane doesn't re-fetch.
    const episodeCache = new Map<number, { episodes: Episode[]; at: number }>();

    const queue = new DownloadQueue({
      net: options.net,
      connections: options.connections,
      concurrency: options.concurrency,
      onUpdate: scheduleDraw,
    });

    const width = (): number => process.stdout.columns ?? 80;
    const height = (): number => process.stdout.rows ?? 24;
    const pageSize = (): number => computePageHeight(height(), queue.snapshot().length);

    const draw = (): void => {
      pendingDraw = null;
      const rows = renderBrowse({
        state,
        width: width(),
        height: height(),
        message,
        jobs: queue.snapshot(),
        mode,
        queueCursor,
        now: Date.now(),
      });

      // First frame: clear the whole (alternate) screen once.
      if (lastRows === null) process.stdout.write(`${ESC}[2J${ESC}[H`);

      // Incremental redraw: only rewrite lines whose rendered content changed, so
      // navigating never repaints the whole screen (which is what caused the title
      // bar to flash). Unchanged lines are left exactly as they are.
      const count = Math.max(rows.length, lastRows?.length ?? 0);
      for (let i = 0; i < count; i++) {
        const row = rows[i];
        if (lastRows !== null && i < lastRows.length && rowKey(row) === rowKey(lastRows[i])) {
          continue;
        }
        // Write the new content, then erase to end-of-line — never a blank gap.
        process.stdout.write(`${ESC}[${i + 1};1H` + (row ? renderRow(row) + `${ESC}[K` : `${ESC}[2K`));
      }
      lastRows = rows;
      syncAnim();
    };

    /** Starts/stops the marquee animation timer based on whether the selected cell overflows. */
    function syncAnim(): void {
      const needs = mode === 'browse' && activeMarquee(state, width());
      if (needs && animTimer === null) {
        animTimer = setInterval(() => {
          if (!finishing) draw();
        }, 130);
      } else if (!needs && animTimer !== null) {
        clearInterval(animTimer);
        animTimer = null;
      }
    }

    /** Stable identity of a rendered row, used to skip unchanged lines. */
    function rowKey(row: ScreenRow | undefined): string {
      if (!row) return 'empty';
      const ranges = (row.ranges ?? []).map((r) => `${r.start}:${r.end}`).join(',');
      return `${row.style ?? ''}|${row.text}|${ranges}`;
    }

    /**
     * Applies the row's style (title/footer/dim colors) and reverse-video only on
     * its highlighted ranges (the selected cell), never the whole line.
     */
    function renderRow(row: ScreenRow): string {
      const open = row.style ? STYLE[row.style] : '';
      if (!row.ranges || row.ranges.length === 0) return open + row.text + RESET;
      let out = open;
      let last = 0;
      for (const range of row.ranges) {
        out += row.text.slice(last, range.start) + SELECT_STYLE + row.text.slice(range.start, range.end) + RESET + open;
        last = range.end;
      }
      return out + row.text.slice(last) + RESET;
    }

    /** Coalesces rapid queue updates into at most one redraw per interval. */
    function scheduleDraw(): void {
      if (finishing) return;
      const now = Date.now();
      if (now - lastDraw >= DRAW_INTERVAL_MS) {
        lastDraw = now;
        draw();
        return;
      }
      if (!pendingDraw) {
        pendingDraw = setTimeout(() => {
          lastDraw = Date.now();
          draw();
        }, Math.max(1, DRAW_INTERVAL_MS - (now - lastDraw)));
      }
    }

    const finish = (): void => {
      if (finishing) return;
      finishing = true;
      if (pendingDraw) clearTimeout(pendingDraw);
      if (animTimer) {
        clearInterval(animTimer);
        animTimer = null;
      }
      process.stdin.removeListener('keypress', onKey);
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(`${ESC}[?25h${ALT_OFF}`);
      resolve({ action: { type: 'exit' }, queue });
    };

    const onKey = (str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (finishing) return;

      // Keys that work in both modes.
      if (key.ctrl && key.name === 'c') {
        finish();
        return;
      }
      if (key.name === 'q' && (mode === 'queue' || state.active !== 2)) {
        finish();
        return;
      }
      if (key.name === 'tab') {
        mode = mode === 'browse' ? 'queue' : 'browse';
        queueCursor = clamp(queueCursor, queue.snapshot().length);
        draw();
        return;
      }

      // The Downloads view is separate from browsing the catalogue.
      if (mode === 'queue') {
        const jobs = queue.snapshot();
        switch (key.name) {
          case 'up':
            queueCursor = clamp(queueCursor - 1, jobs.length);
            break;
          case 'down':
            queueCursor = clamp(queueCursor + 1, jobs.length);
            break;
          case 'pageup':
            queueCursor = clamp(queueCursor - pageSize(), jobs.length);
            break;
          case 'pagedown':
            queueCursor = clamp(queueCursor + pageSize(), jobs.length);
            break;
          case 'home':
            queueCursor = 0;
            break;
          case 'end':
            queueCursor = jobs.length > 0 ? jobs.length - 1 : 0;
            break;
          case 'backspace':
          case 'escape':
            mode = 'browse';
            break;
          case 'x': {
            const job = jobs[queueCursor];
            if (job) {
              queue.cancel(job.id);
              queueCursor = clamp(queueCursor, queue.snapshot().length);
            }
            break;
          }
          default:
            return;
        }
        draw();
        return;
      }

      let step;
      switch (key.name) {
        case 'up':
          step = moveUp(state);
          break;
        case 'down':
          step = moveDown(state);
          break;
        case 'pageup':
          step = pageUp(state, pageSize());
          break;
        case 'pagedown':
          step = pageDown(state, pageSize());
          break;
        case 'home':
          step = goHome(state);
          break;
        case 'end':
          step = goEnd(state);
          break;
        case 'left':
          step = moveLeft(state);
          break;
        case 'right':
          step = moveRight(state);
          break;
        case 'return':
        case 'space':
          step = state.active === 3 ? toggleEpisode(state, state.episodeCursor) : moveRight(state);
          break;
        case 'backspace':
          step = state.active === 2 && state.filter.length > 0 ? backspaceFilter(state) : moveLeft(state);
          break;
        default:
          if (key.name === 'r') {
            // On episodes: force-reload that series' episodes. Elsewhere: reload
            // the catalogue (refreshes the series lists).
            if (state.active === 3 && state.selectedSeries) void startLoad(state.selectedSeries, true);
            else void reloadCatalog();
            return;
          }
          if (key.name === 'd' && state.active === 3) step = queueDownload(state);
          else if (key.name === 'a' && state.active === 3) step = toggleSelectAll(state);
          else if (str && str.length === 1 && str.codePointAt(0)! >= 32 && str !== '\x7f') {
            step = typeFilter(state, str);
          } else return;
      }

      state = step.state;
      if (step.action.type === 'queue') {
        const seriesDir = resolveSeriesDir(
          step.action.outDir,
          sanitizeFilename(step.action.series.title),
        );
        queue.add(step.action.series.title, step.action.episodes, seriesDir);
        message = `Queued ${step.action.episodes.length} episode(s) of ${step.action.series.title}.`;
      } else if (step.action.type === 'load-episodes') {
        void startLoad(step.action.series);
        message = '';
      } else {
        message = '';
      }
      draw();
    };

    const startLoad = async (series: Anime, force = false): Promise<void> => {
      const token = ++loadToken;
      const cached = episodeCache.get(series.catId);
      if (!force && cached && Date.now() - cached.at < EPISODE_TTL_MS) {
        state = setEpisodes(beginEpisodeLoad(state, series), cached.episodes, null);
        if (!finishing) draw();
        return;
      }
      state = beginEpisodeLoad(state, series);
      draw();
      try {
        const episodes = await fetchEpisodes(series.catId, options.net);
        if (token !== loadToken) return;
        episodeCache.set(series.catId, { episodes, at: Date.now() });
        state = setEpisodes(state, episodes, null);
      } catch (err) {
        if (token !== loadToken) return;
        state = setEpisodes(state, [], err instanceof Error ? err.message : String(err));
      }
      if (!finishing) draw();
    };

    /** Re-fetches the catalogue to refresh the series lists (the 'r' reload). */
    const reloadCatalog = async (): Promise<void> => {
      message = 'Reloading catalogue...';
      draw();
      try {
        const catalog = await fetchCatalog(options.net);
        episodeCache.clear(); // series may have changed
        state = replaceCatalog(state, catalog);
        message = 'Catalogue reloaded.';
      } catch (err) {
        message = `Catalogue reload failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!finishing) draw();
    };

    const onResize = (): void => {
      lastRows = null; // terminal geometry changed — force a full repaint
      draw();
    };
    emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKey);
    process.stdout.on('resize', onResize);
    process.stdin.resume();
    process.stdout.write(`${ALT_ON}${ESC}[?25l`);
    draw();
  });
}
