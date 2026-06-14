import { SITE } from './constants.js';
import { httpRequest } from './http.js';
import type { Episode, NetOptions } from './types.js';

const MAX_PAGES = 60;

/**
 * Loads every episode for a category, following pagination for long-running series.
 */
export async function fetchEpisodes(catId: number, net: NetOptions = {}): Promise<Episode[]> {
  const res = await httpRequest(`${SITE}/?cat=${catId}`, { net });
  if (!res.ok) {
    throw new Error(`Failed to load category ${catId} (HTTP ${res.status})`);
  }
  const html = await res.text();
  const episodes = parseEpisodes(html);

  const { root, maxPage } = parsePagination(html);
  if (root && maxPage > 1) {
    for (let page = 2; page <= Math.min(maxPage, MAX_PAGES); page++) {
      const pageRes = await httpRequest(`${root}page/${page}`, { net });
      if (!pageRes.ok) break;
      episodes.push(...parseEpisodes(await pageRes.text()));
    }
  }
  return dedupeAndSort(episodes);
}

export function parseEpisodes(html: string): Episode[] {
  const episodes: Episode[] = [];
  const blocks = html.split('<article');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const apiMatch = block.match(/data-apireq="([^"]+)"/);
    if (!apiMatch) continue;
    const titleMatch = block.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/);
    const title = titleMatch ? stripTags(titleMatch[1]) : 'Untitled';
    episodes.push({ title, apiReq: apiMatch[1], number: parseEpisodeNumber(title) });
  }
  return episodes;
}

export function parsePagination(html: string): { root: string | null; maxPage: number } {
  const matches = [...html.matchAll(/href="([^"]*\/category\/[^"]*?\/page\/(\d+))[^"]*"/g)];
  if (matches.length === 0) return { root: null, maxPage: 1 };
  let maxPage = 1;
  let root: string | null = null;
  for (const match of matches) {
    const pageNum = Number(match[2]);
    if (pageNum > maxPage) maxPage = pageNum;
    if (!root) root = match[1].replace(/page\/\d+\/?$/, '');
  }
  return { root, maxPage };
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEpisodeNumber(title: string): number | null {
  const match = title.match(/\[(\d+)(?:-\d+)?\]\s*$/);
  return match ? Number(match[1]) : null;
}

function dedupeAndSort(episodes: Episode[]): Episode[] {
  const seen = new Set<string>();
  const unique = episodes.filter((episode) => {
    if (seen.has(episode.apiReq)) return false;
    seen.add(episode.apiReq);
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
