// Thin terminal-I/O shell around the pure browse model + renderer + the
// background DownloadQueue. Owns raw keypress handling, screen drawing, the
// async episode loads, and the live queue panel. All layout/navigation/queue
// logic lives in model.ts / render.ts / downloader.ts (which are unit-tested).

import { emitKeypressEvents } from 'node:readline';
import type { Anime, NetOptions } from 'anime1-core';
import { fetchEpisodes, sanitizeFilename } from 'anime1-core';
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
  setEpisodes,
  toggleEpisode,
  toggleSelectAll,
  typeFilter,
} from './model.js';
import type { ActionResult, BrowseState } from './model.js';
import { computePageHeight, renderBrowse } from './render.js';
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
const REVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;
const ALT_ON = `${ESC}[?1049h`; // enter alternate screen buffer
const ALT_OFF = `${ESC}[?1049l`; // leave alternate screen buffer
const DRAW_INTERVAL_MS = 120;

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
      });
      // Repaint in place — no full-screen reset/clear, which is what causes the
      // flash. Home the cursor, rewrite each line (clearing it first so a shorter
      // line never leaves stale characters), then clear any leftover rows below.
      process.stdout.write(`${ESC}[H`);
      for (const row of rows) {
        process.stdout.write(renderRow(row) + `${ESC}[K\n`);
      }
      process.stdout.write(`${ESC}[J`);
    };

    /**
     * Applies reverse-video only to the row's highlighted ranges (the selected
     * cell), never the whole line.
     */
    function renderRow(row: ScreenRow): string {
      if (!row.ranges || row.ranges.length === 0) return row.text;
      let out = '';
      let last = 0;
      for (const range of row.ranges) {
        out += row.text.slice(last, range.start) + REVERSE + row.text.slice(range.start, range.end) + RESET;
        last = range.end;
      }
      return out + row.text.slice(last);
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

    const startLoad = async (series: Anime): Promise<void> => {
      const token = ++loadToken;
      state = beginEpisodeLoad(state, series);
      draw();
      try {
        const episodes = await fetchEpisodes(series.catId, options.net);
        if (token !== loadToken) return;
        state = setEpisodes(state, episodes, null);
      } catch (err) {
        if (token !== loadToken) return;
        state = setEpisodes(state, [], err instanceof Error ? err.message : String(err));
      }
      if (!finishing) draw();
    };

    const onResize = (): void => draw();
    emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKey);
    process.stdout.on('resize', onResize);
    process.stdin.resume();
    process.stdout.write(`${ALT_ON}${ESC}[?25l`);
    draw();
  });
}
