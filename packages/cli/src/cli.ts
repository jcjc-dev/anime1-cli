#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  fetchCatalog,
  fetchEpisodes,
  resolveSource,
  downloadSource,
  extensionFromType,
  sanitizeFilename,
  filterByYearSeason,
  listSeasons,
  listYears,
  searchByTitle,
  normalizeSeason,
  setMinRequestInterval,
  SEASON_EN,
  DEFAULT_CONNECTIONS,
  MAX_CONNECTIONS,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
} from 'anime1-core';
import type { Anime, Episode, NetOptions } from 'anime1-core';
import { MAX_CONCURRENCY, VERSION } from './constants.js';
import { askOutputDir, pickEpisodes, pickSeason, pickSeries, pickYear } from './prompts.js';
import { createSpinner, createProgressBar } from './ui.js';
import { parseMinInterval, resolveBaseDir, resolveSeriesDir } from './args.js';

interface CliOptions {
  year?: string;
  season?: string;
  search?: string;
  cat?: string;
  all?: boolean;
  out?: string;
  list?: boolean;
  extract?: boolean;
  concurrency: string;
  connections: string;
  minInterval: string;
  userAgent?: string;
  cfClearance?: string;
}

const program = new Command();
program
  .name('anime1')
  .description('Browse anime1.me by year and season and download episodes.')
  .version(VERSION)
  .option('--year <year>', 'filter by year, e.g. 2025')
  .option('--season <season>', 'filter by season: spring|summer|autumn|winter or 春夏秋冬')
  .option('--search <text>', 'filter series by title text')
  .option('--cat <id>', 'jump straight to a category id (skip browsing)')
  .option('--all', 'download all episodes without prompting')
  .option('--out <dir>', 'output directory')
  .option('--list', 'print the catalog (respects --year/--season/--search) and exit')
  .option('--extract', 'print resolved video URLs and cookies instead of downloading')
  .option('--concurrency <n>', `number of episodes to download in parallel (max ${MAX_CONCURRENCY})`, '1')
  .option(
    '--connections <n>',
    `parallel connections per episode for faster downloads (max ${MAX_CONNECTIONS})`,
    String(DEFAULT_CONNECTIONS),
  )
  .option(
    '--min-interval <ms>',
    'minimum delay between requests, polite rate limiting',
    String(DEFAULT_MIN_REQUEST_INTERVAL_MS),
  )
  .option('--user-agent <ua>', 'custom User-Agent (helps bypass Cloudflare)')
  .option('--cf-clearance <cookie>', 'cf_clearance cookie value (helps bypass Cloudflare)')
  .parse();

const opts = program.opts<CliOptions>();
setMinRequestInterval(parseMinInterval(opts.minInterval, DEFAULT_MIN_REQUEST_INTERVAL_MS));
const net: NetOptions = { userAgent: opts.userAgent, cfClearance: opts.cfClearance };
const connections = Math.min(Math.max(1, Number(opts.connections) || 1), MAX_CONNECTIONS);
const isTty = process.stdout.isTTY === true;

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${message}\n`);
  process.exit(1);
});

async function main(): Promise<void> {
  const catalog = await loadCatalog();
  process.stdout.write(`Loaded ${catalog.length} titles.\n`);

  if (opts.list) {
    printList(catalog);
    return;
  }

  const series = await resolveSeries(catalog);
  const catId = series?.catId ?? Number(opts.cat);
  const episodes = await loadEpisodes(catId);
  const chosen = await chooseEpisodes(episodes);
  if (chosen.length === 0) {
    process.stdout.write('Nothing selected.\n');
    return;
  }

  if (opts.extract) {
    await extractEpisodes(chosen);
    return;
  }

  const outDir = await resolveOutDir(series);
  await downloadEpisodes(chosen, outDir);
}

async function loadCatalog(): Promise<Anime[]> {
  const spinner = createSpinner('Fetching anime1.me catalog...');
  spinner.start();
  try {
    return await fetchCatalog(net);
  } finally {
    spinner.stop();
  }
}

async function resolveSeries(catalog: Anime[]): Promise<Anime | null> {
  if (opts.cat) {
    const catId = Number(opts.cat);
    if (Number.isNaN(catId)) throw new Error('--cat must be a numeric category id.');
    return catalog.find((anime) => anime.catId === catId) ?? null;
  }

  const year = opts.year ?? (await pickYear(catalog));
  const season = opts.season ? normalizeSeason(opts.season) : await pickSeason(catalog, year);

  let pool = filterByYearSeason(catalog, year, season);

  // An explicit --search that uniquely matches resolves directly to that series.
  if (opts.search) {
    pool = searchByTitle(pool, opts.search);
    if (pool.length === 0) {
      throw new Error(`No downloadable series found for ${year} ${season} matching "${opts.search}".`);
    }
    if (pool.length === 1) return pool[0];
  }

  if (pool.length === 0) {
    throw new Error(`No downloadable series found for ${year} ${season}.`);
  }

  // Non-interactive runs must resolve to a single series.
  if (!isTty) {
    if (pool.length === 1) return pool[0];
    throw new Error('Multiple series match. Refine with --search, or run in an interactive terminal.');
  }

  // Interactive browsing: always let the user see and choose, even for one match.
  return pickSeries(pool);
}

async function loadEpisodes(catId: number): Promise<Episode[]> {
  if (Number.isNaN(catId) || catId <= 0) {
    throw new Error('Could not determine a category to load episodes from.');
  }
  const spinner = createSpinner(`Loading episodes for category ${catId}...`);
  spinner.start();
  try {
    const episodes = await fetchEpisodes(catId, net);
    if (episodes.length === 0) throw new Error('No episodes found for this category.');
    return episodes;
  } finally {
    spinner.stop();
  }
}

async function chooseEpisodes(episodes: Episode[]): Promise<Episode[]> {
  if (opts.all || opts.extract || !isTty) return episodes;
  return pickEpisodes(episodes);
}

async function resolveOutDir(series: Anime | null): Promise<string> {
  let base = opts.out;
  if (!resolveBaseDir(base, '') && isTty && !opts.all) {
    base = await askOutputDir('./downloads');
  }
  const resolvedBase = resolveBaseDir(base, './downloads');
  const sub = series ? sanitizeFilename(series.title) : '';
  return resolveSeriesDir(resolvedBase, sub);
}

async function extractEpisodes(episodes: Episode[]): Promise<void> {
  for (const episode of episodes) {
    try {
      const source = await resolveSource(episode.apiReq, net);
      const cookies = Object.entries(source.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      process.stdout.write(
        `\n${episode.title}\n  url: ${source.src}\n  type: ${source.type}\n  hls: ${source.isHls}\n  cookie: ${cookies}\n`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n${episode.title}\n  error: ${message}\n`);
    }
  }
}

async function downloadEpisodes(episodes: Episode[], outDir: string): Promise<void> {
  const requested = Math.max(1, Number(opts.concurrency) || 1);
  const concurrency = Math.min(requested, MAX_CONCURRENCY);
  if (requested > concurrency) {
    process.stdout.write(`Note: capping concurrency at ${MAX_CONCURRENCY} to avoid overloading the server.\n`);
  }
  process.stdout.write(`Downloading ${episodes.length} episode(s) to ${outDir}\n`);

  if (concurrency === 1) {
    for (let i = 0; i < episodes.length; i++) {
      await downloadOne(episodes[i], outDir, i + 1, episodes.length, false);
    }
  } else {
    await runPool(episodes, concurrency, (episode, index) =>
      downloadOne(episode, outDir, index + 1, episodes.length, true),
    );
  }
  process.stdout.write('\nDone.\n');
}

async function downloadOne(
  episode: Episode,
  outDir: string,
  index: number,
  total: number,
  quiet: boolean,
): Promise<void> {
  const label = `[${index}/${total}] ${episode.title}`;
  try {
    const source = await resolveSource(episode.apiReq, net);
    if (source.isHls) {
      process.stdout.write(`\n${label}\n  Skipped: HLS stream (.m3u8) not supported yet.\n`);
      return;
    }
    const ext = extensionFromType(source.type);
    const outPath = resolve(outDir, `${sanitizeFilename(episode.title)}.${ext}`);

    if (quiet || !isTty) {
      process.stdout.write(`${label} ...\n`);
      await downloadSource(source, outPath, { net, connections });
      process.stdout.write(`${label} ✓ saved\n`);
    } else {
      const bar = createProgressBar(label);
      try {
        await downloadSource(source, outPath, {
          net,
          connections,
          onProgress: ({ received, total: bytesTotal }) => bar.update(received, bytesTotal),
        });
      } catch (err) {
        bar.clear();
        throw err;
      }
      bar.finish(`${label}  ✓ saved`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${label}  ✗ ${message}\n`);
  }
}

function printList(catalog: Anime[]): void {
  const years = opts.year ? [opts.year] : listYears(catalog);
  const seasonFilter = opts.season ? normalizeSeason(opts.season) : null;

  for (const year of years) {
    const seasons = listSeasons(catalog, year).filter((s) => !seasonFilter || s === seasonFilter);
    if (seasons.length === 0) continue;
    process.stdout.write(`\n${year}\n`);
    for (const season of seasons) {
      let items = filterByYearSeason(catalog, year, season);
      if (opts.search) items = searchByTitle(items, opts.search);
      if (items.length === 0) continue;
      process.stdout.write(`  ${season} ${SEASON_EN[season] ?? ''} (${items.length})\n`);
      for (const anime of items) {
        process.stdout.write(`    [${anime.catId}] ${anime.title} — ${anime.episodes}\n`);
      }
    }
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = cursor++;
      if (current >= items.length) break;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}
