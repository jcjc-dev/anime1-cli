// Thin terminal-I/O shell around the pure browse model + renderer. Owns raw
// keypress handling, screen drawing, and the async episode loads; all layout and
// navigation logic lives in model.ts / render.ts (which are unit-tested).

import { emitKeypressEvents } from 'node:readline';
import type { Anime, NetOptions } from 'anime1-core';
import { fetchEpisodes } from 'anime1-core';
import {
  backspaceFilter,
  beginEpisodeLoad,
  confirmDownload,
  createBrowseState,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  setEpisodes,
  toggleEpisode,
  typeFilter,
} from './model.js';
import type { ActionResult, BrowseState, Step } from './model.js';
import { renderBrowse } from './render.js';

export interface TuiOptions {
  net: NetOptions;
  outDir: string;
}

const ESC = '\x1b';
const REVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;

/**
 * Runs the interactive columnar browser until the user confirms a download or
 * quits. Resolves with the chosen action (never rejects on key handling).
 */
export async function runTui(catalog: Anime[], options: TuiOptions): Promise<ActionResult> {
  return new Promise((resolve) => {
    let state: BrowseState = createBrowseState(catalog, options.outDir);
    let loadToken = 0;
    let finishing = false;
    let message = '';

    const width = (): number => process.stdout.columns ?? 80;

    const draw = (): void => {
      const rows = renderBrowse({ state, width: width(), message });
      process.stdout.write(`${ESC}c${ESC}[?25l`); // clear, home, hide cursor
      for (const row of rows) {
        const text = row.highlight ? `${REVERSE}${row.text}${RESET}` : row.text;
        process.stdout.write(`${text}\n`);
      }
    };

    const finish = (action: ActionResult): void => {
      if (finishing) return;
      finishing = true;
      process.stdin.removeListener('keypress', onKey);
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(`${ESC}[?25h${ESC}[2J${ESC}[H`);
      resolve(action);
    };

    const onKey = (str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (finishing) return;
      let step: Step;
      switch (key.name) {
        case 'up':
          step = moveUp(state);
          break;
        case 'down':
          step = moveDown(state);
          break;
        case 'left':
          step = moveLeft(state);
          break;
        case 'right':
          step = moveRight(state);
          break;
        case 'return':
        case 'space':
          step =
            state.active === 3
              ? toggleEpisode(state, state.episodeCursor)
              : moveRight(state);
          break;
        case 'backspace':
          step = state.active === 2 && state.filter.length > 0 ? backspaceFilter(state) : moveLeft(state);
          break;
        default:
          if (key.ctrl && key.name === 'c') {
            finish({ type: 'exit' });
            return;
          }
          if (key.name === 'd' && state.active === 3) step = confirmDownload(state);
          else if (key.name === 'q' && state.active !== 2)
            step = { state, action: { type: 'exit' } as ActionResult };
          else if (str && str.length === 1 && str.codePointAt(0)! >= 32 && str !== '\x7f') {
            step = typeFilter(state, str);
          } else return;
      }

      state = step.state;
      if (step.action.type === 'exit') {
        finish({ type: 'exit' });
        return;
      }
      if (step.action.type === 'download') {
        finish(step.action);
        return;
      }
      if (step.action.type === 'load-episodes') void startLoad(step.action.series);
      message = '';
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
    draw();
  });
}
