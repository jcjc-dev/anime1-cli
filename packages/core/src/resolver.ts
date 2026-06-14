import { MAX_CATEGORY_PAGES, SITE } from './constants.js';
import { httpRequest } from './http.js';
import type { Episode, NetOptions } from './types.js';

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
  // A substantial page that yields zero episodes almost always means the site
  // markup changed and our parser needs updating — distinct from an empty
  // category. Make that diagnosable instead of surfacing as "no episodes".
  if (episodes.length === 0 && looksLikeContentPage(html)) {
    throw new Error(
      `Loaded category ${catId} (${html.length} bytes) but found no recognizable episodes. ` +
        'anime1.me markup may have changed — the parser likely needs updating.',
    );
  }

  const { root, maxPage } = parsePagination(html);
  if (root && maxPage > 1) {
    const siteOrigin = new URL(SITE).origin;
    const lastPage = Math.min(maxPage, MAX_CATEGORY_PAGES);
    for (let page = 2; page <= lastPage; page++) {
      const pageUrl = safeSameOriginUrl(root, page, siteOrigin);
      if (!pageUrl) break; // pagination link points off-site; stop crawling.
      const pageRes = await httpRequest(pageUrl, { net });
      if (!pageRes.ok) break;
      episodes.push(...parseEpisodes(await pageRes.text()));
    }
    if (maxPage > MAX_CATEGORY_PAGES) {
      // Visible signal instead of silent truncation. Core has no logger, so we
      // surface it on stderr; the engine stays UI-agnostic (no formatting).
      process.stderr.write(
        `anime1-core: category has ${maxPage} pages; only the first ${MAX_CATEGORY_PAGES} were fetched.\n`,
      );
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

/**
 * Heuristic: did we fetch a real content page (vs an empty/blocked stub)? Used
 * to tell "site markup changed, parser broke" apart from "category is empty".
 */
export function looksLikeContentPage(html: string): boolean {
  return html.length > 1024 && /<article|entry-title|vjscontainer/i.test(html);
}

/**
 * Resolves a paginated category URL and returns it only when it stays on the
 * trusted site origin. A pagination href that points at another host (poisoned
 * or MITM'd markup) returns null so we never crawl off-site with auth cookies.
 */
function safeSameOriginUrl(root: string, page: number, siteOrigin: string): string | null {
  try {
    const url = new URL(`${root}page/${page}`, siteOrigin);
    return url.origin === siteOrigin ? url.toString() : null;
  } catch {
    return null;
  }
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
