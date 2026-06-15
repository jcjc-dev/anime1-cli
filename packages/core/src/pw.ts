// anime1.pw resolver. Unlike anime1.me, anime1.pw exposes a direct (signed) MP4
// `<source>` tag on each episode page, so no API call or cookies are needed.
// HTML is parsed with regex to keep anime1-core dependency-free.

import { MAX_CATEGORY_PAGES } from './constants.js';
import { httpRequest } from './http.js';
import { parseEpisodeNumber } from './resolver.js';
import type { Episode, NetOptions, ResolvedSource } from './types.js';

const EPISODE_LINK =
  /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const TITLE_TAG = /<h[12][^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i;
const SOURCE_TAG = /<source\b[^>]*>/gi;
const ATTR = (name: string): RegExp => new RegExp(`${name}="([^"]*)"`, 'i');

export interface PwSeasonPage {
  episodes: Array<{ url: string; title: string }>;
  nextUrl: string | null;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function isHlsSrc(src: string): boolean {
  return /\.m3u8(\?|$)/i.test(src);
}

/** Returns the first MP4-compatible `<source>` URL on an episode page. */
export function selectMp4Source(html: string, baseUrl: string): string | null {
  const candidates: Array<{ src: string; mp4: boolean }> = [];
  for (const tag of html.match(SOURCE_TAG) ?? []) {
    const srcMatch = ATTR('src').exec(tag);
    if (!srcMatch?.[1]) continue;
    const resolved = absolute(srcMatch[1], baseUrl);
    if (!resolved) continue;
    const type = ATTR('type').exec(tag)?.[1]?.toLowerCase() ?? '';
    const mp4 = type === 'video/mp4' || /\.mp4(\?|$)/i.test(resolved);
    candidates.push({ src: resolved, mp4 });
  }
  const mp4 = candidates.find((candidate) => candidate.mp4);
  return mp4?.src ?? candidates[0]?.src ?? null;
}

/** Parses episode page links and the next-page URL from a category page. */
export function parsePwSeasonPage(html: string, baseUrl: string): PwSeasonPage {
  const episodes: Array<{ url: string; title: string }> = [];
  for (const match of html.matchAll(EPISODE_LINK)) {
    const url = absolute(match[1], baseUrl);
    if (url) episodes.push({ url, title: stripTags(match[2]) });
  }
  return { episodes, nextUrl: parseNextUrl(html, baseUrl) };
}

function parseNextUrl(html: string, baseUrl: string): string | null {
  // WordPress "older posts" link is the chronological next page.
  const navPrev = html.match(
    /<div[^>]*class="[^"]*nav-previous[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i,
  );
  if (navPrev) return absolute(navPrev[1], baseUrl);
  const relNext =
    html.match(/<a[^>]+rel="next"[^>]*href="([^"]+)"/i) ??
    html.match(/<a[^>]+href="([^"]+)"[^>]*rel="next"/i);
  return relNext ? absolute(relNext[1], baseUrl) : null;
}

/** Parses an episode page into its direct video URL and display title. */
export function parsePwEpisodePage(html: string, baseUrl: string): { src: string; title: string } {
  const titleMatch = html.match(TITLE_TAG);
  const title = titleMatch ? stripTags(titleMatch[1]) : 'Untitled';
  const src = selectMp4Source(html, baseUrl);
  if (!src) {
    throw new Error('anime1.pw episode page is missing an MP4 <source>; markup may have changed.');
  }
  return { src, title };
}

async function fetchPwEpisodePage(
  url: string,
  net: NetOptions,
): Promise<{ src: string; title: string }> {
  const res = await httpRequest(url, { net });
  if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  return parsePwEpisodePage(await res.text(), url);
}

function sourceFor(src: string): ResolvedSource {
  return { src, type: 'video/mp4', cookies: {}, isHls: isHlsSrc(src) };
}

/** Resolves one anime1.pw episode page URL into a downloadable source. */
export async function resolvePwEpisode(url: string, net: NetOptions = {}): Promise<ResolvedSource> {
  const { src } = await fetchPwEpisodePage(url, net);
  return sourceFor(src);
}

/** Fetches a single anime1.pw episode into an Episode with a pre-resolved source. */
export async function fetchPwEpisode(url: string, net: NetOptions = {}): Promise<Episode> {
  const { src, title } = await fetchPwEpisodePage(url, net);
  return { title, pageUrl: url, number: parseEpisodeNumber(title), source: sourceFor(src) };
}

/** Collects every anime1.pw episode reachable from a category/season URL. */
export async function fetchPwEpisodes(url: string, net: NetOptions = {}): Promise<Episode[]> {
  const episodes: Episode[] = [];
  const seen = new Set<string>();
  let current: string | null = url;
  let pages = 0;

  while (current && pages < MAX_CATEGORY_PAGES) {
    if (seen.has(current)) break;
    seen.add(current);
    pages++;

    const res = await httpRequest(current, { net });
    if (!res.ok) throw new Error(`Failed to load ${current} (HTTP ${res.status})`);
    const page = parsePwSeasonPage(await res.text(), current);
    if (page.episodes.length === 0 && pages === 1) {
      throw new Error(
        `Loaded ${current} but found no anime1.pw episodes. The site markup may have changed.`,
      );
    }
    for (const episode of page.episodes) {
      episodes.push({
        title: episode.title,
        pageUrl: episode.url,
        number: parseEpisodeNumber(episode.title),
      });
    }
    current = page.nextUrl;
  }

  return dedupeAndSort(episodes);
}

function dedupeAndSort(episodes: Episode[]): Episode[] {
  const seen = new Set<string>();
  const unique = episodes.filter((episode) => {
    const key = episode.pageUrl ?? episode.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => {
    if (a.number != null && b.number != null) return a.number - b.number;
    if (a.number != null) return -1;
    if (b.number != null) return 1;
    return 0;
  });
  return unique;
}
