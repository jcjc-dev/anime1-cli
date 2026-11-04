import { describe, expect, it } from 'vitest';
import type { Anime, Episode } from 'anime1-core';
import {
  createBrowseState,
  goEnd,
  moveRight,
  setEpisodes,
  toggleEpisode,
} from '../src/tui/model.js';
import { computePageHeight, renderBrowse } from '../src/tui/render.js';
import { displayWidth } from '../src/ui.js';

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
  s = moveRight(s).state;
  s = moveRight(s).state;
  s = moveRight(s).state;
  return setEpisodes(s, eps, null);
}

function textOf(rows: Array<{ text: string }>): string {
  return rows.map((r) => r.text).join('\n');
}

function ctx(
  state: ReturnType<typeof createBrowseState>,
  height = 24,
  width = 120,
): { state: ReturnType<typeof createBrowseState>; width: number; height: number } {
  return { state, width, height };
}

describe('computePageHeight', () => {
  it('reserves rows for chrome and the queue panel', () => {
    expect(computePageHeight(24, 0)).toBe(19);
    expect(computePageHeight(24, 3)).toBeLessThan(19);
    expect(computePageHeight(10, 0)).toBeGreaterThanOrEqual(3);
  });
});

describe('renderBrowse', () => {
  it('renders pane headers and the footer', () => {
    const rows = renderBrowse(ctx(createBrowseState(catalog, './downloads')));
    const text = textOf(rows);
    expect(text).toContain('Years');
    expect(text).toContain('Seasons');
    expect(text).toContain('Series');
    expect(text).toContain('Episodes');
    expect(text).toContain('PgUp/PgDn');
  });

  it('shows a breadcrumb of the current section', () => {
    const rows = renderBrowse(ctx(toEpisodes()));
    const text = textOf(rows);
    expect(text).toContain('2025 › 夏 Summer › Alpha');
  });

  it('marks the active column header with a pointer and gives it its own style', () => {
    const rows = renderBrowse(ctx(createBrowseState(catalog, './downloads')));
    expect(textOf(rows)).toContain('▸ Years');
    const header = rows.find((r) => r.text.startsWith('▸'));
    expect(header?.style).toBe('header');
    // The header must NOT use the selection highlight (no ranges).
    expect(header?.ranges?.length ?? 0).toBe(0);
  });

  it('highlights only the cursor cell, not the whole row', () => {
    const rows = renderBrowse(ctx(createBrowseState(catalog, './downloads')));
    // Header row has its own style, no selection highlight.
    const header = rows.find((r) => r.text.startsWith('▸'));
    expect(header?.style).toBe('header');
    expect(header?.ranges?.length ?? 0).toBe(0);
    // Exactly one item row carries a highlight range: the cursor cell.
    const itemRows = rows.filter((r) => (r.ranges?.length ?? 0) > 0);
    expect(itemRows).toHaveLength(1);
    const row = itemRows[0];
    const range = row.ranges![0];
    expect(row.text.slice(range.start, range.end)).toContain('2025');
    expect(range.end - range.start).toBeLessThan(row.text.length);
  });

  it('marks selected episodes with [x]', () => {
    let state = toEpisodes();
    state = toggleEpisode(state, 0).state;
    const text = textOf(renderBrowse(ctx(state)));
    expect(text).toContain('[x] Alpha [1]');
    expect(text).toContain('[ ] Alpha [2]');
  });

  it('windows a long list and shows scroll markers', () => {
    // 40 series in one year+season.
    const big: Anime[] = Array.from({ length: 40 }, (_, i) => anime(i + 1, `Series ${String(i + 1).padStart(2, '0')}`, '2025', '夏'));
    let s = createBrowseState(big, './downloads');
    s = moveRight(s).state; // seasons
    s = moveRight(s).state; // series pane (active 2), cursor 0
    const top = renderBrowse(ctx(s, 24, 120));
    const topText = textOf(top);
    // Not every series fits; a scroll-down marker appears.
    expect(topText).not.toContain('Series 40');
    expect(topText).toContain('▼');
    // Moving to the end scrolls the window down and shows an up marker.
    const bottom = renderBrowse(ctx(goEnd(s).state, 24, 120));
    const bottomText = textOf(bottom);
    expect(bottomText).toContain('Series 40');
    expect(bottomText).toContain('▲');
  });

  it('shows a loading placeholder while episodes load', () => {
    const state = { ...toEpisodes(), episodesLoading: true, episodes: [] };
    expect(textOf(renderBrowse(ctx(state)))).toContain('(loading…)');
  });

  it('never produces rows wider than the requested width', () => {
    const rows = renderBrowse(ctx(toEpisodes(), 24, 80));
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(80);
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
        status: 'downloading' as const,
        progress: { received: 512, total: 1024 },
        outDir: './downloads/Alpha',
      },
      {
        id: 1,
        seriesTitle: 'Alpha',
        episode: { title: 'Alpha [1]', number: 1, apiReq: 'a' },
        status: 'queued' as const,
        progress: { received: 0, total: null },
        outDir: './downloads/Alpha',
      },
    ];
    const rows = renderBrowse({ state, width: 160, height: 30, jobs });
    const text = textOf(rows);
    expect(text).toContain('Downloads (2)');
    expect(text).toContain('Alpha — Alpha [2]');
    expect(text).toContain('Alpha — Alpha [1]');
  });

  it('omits the queue panel when there are no jobs', () => {
    const rows = renderBrowse(ctx(toEpisodes()));
    expect(textOf(rows)).not.toContain('Downloads (');
  });
});

describe('column alignment', () => {
  it('does not collapse shorter columns into later columns', () => {
    let s = createBrowseState(catalog, './downloads'); // years: [2025, 2024], seasons: [夏, 冬]
    s = moveRight(s).state; // seasons pane
    s = moveRight(s).state; // series pane (active 2), cursor on Alpha
    const rows = renderBrowse(ctx(s, 24, 120));
    const colWidth = Math.max(8, Math.floor((120 - 6) / 4));
    // 'Alpha' must sit in the Series column — past the Years and Seasons cells —
    // not at the left edge under 'Years'.
    const seriesRow = rows.find((r) => r.text.includes('Alpha  1-12'));
    expect(seriesRow).toBeDefined();
    // Measure by display width (columns), which is what the terminal actually
    // aligns on — not raw string length, which miscounts 2-column glyphs like ›.
    const col = seriesRow ? displayWidth(seriesRow.text.slice(0, seriesRow.text.indexOf('Alpha'))) : -1;
    expect(col).toBeGreaterThanOrEqual(2 * colWidth);
  });
});

describe('queue view', () => {
  const jobs = [
    {
      id: 2,
      seriesTitle: 'Alpha',
      episode: { title: 'Alpha [2]', number: 2, apiReq: 'b' },
      status: 'downloading' as const,
      progress: { received: 512, total: 1024 },
      outDir: './downloads/Alpha',
    },
    {
      id: 1,
      seriesTitle: 'Beta',
      episode: { title: 'Beta [1]', number: 1, apiReq: 'a' },
      status: 'queued' as const,
      progress: { received: 0, total: null },
      outDir: './downloads/Beta',
    },
  ];

  it('renders the queue as its own view with a cursor', () => {
    const state = toEpisodes();
    const rows = renderBrowse({ state, width: 160, height: 24, jobs, mode: 'queue', queueCursor: 1 });
    const text = rows.map((r) => r.text).join('\n');
    expect(text).toContain('Downloads (2)');
    expect(text).toContain('Alpha — Alpha [2]');
    expect(text).toContain('Beta — Beta [1]');
    expect(text).toContain('Tab browse');
    // The cursor row (queueCursor 1 = Beta) is highlighted and marked.
    const cursor = rows.find((r) => r.text.startsWith('▸'));
    expect(cursor?.text).toContain('Beta');
    expect(cursor?.ranges?.length).toBeGreaterThan(0);
  });

  it('shows an empty-state message with no jobs', () => {
    const rows = renderBrowse({ state: toEpisodes(), width: 160, height: 24, jobs: [], mode: 'queue', queueCursor: 0 });
    expect(rows.map((r) => r.text).join('\n')).toContain('Queue is empty');
  });
});

describe('styled title bar', () => {
  it('renders the breadcrumb as a full-width styled bar', () => {
    const rows = renderBrowse(ctx(toEpisodes(), 24, 100));
    const title = rows[0];
    expect(title.style).toBe('title');
    expect(title.text).toContain('2025 › 夏 Summer › Alpha');
    // Padded to the full width so the colored bar spans the whole line.
    expect(displayWidth(title.text)).toBe(100);
  });
});
