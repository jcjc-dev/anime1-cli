// Source-agnostic helpers that route a URL or an Episode to the right
// per-source resolver, so frontends can stay unaware of which site a URL is on.

import { resolveSource } from './api.js';
import { fetchPwEpisode, fetchPwEpisodes, resolvePwEpisode } from './pw.js';
import { fetchEpisodesFromUrl } from './resolver.js';
import { ANIME1_PW, classifyUrl } from './sources.js';
import type { Episode, NetOptions, ResolvedSource } from './types.js';

/** Resolves any Episode (anime1.me apiReq, anime1.pw page, or pre-resolved). */
export async function resolveEpisode(
  episode: Episode,
  net: NetOptions = {},
): Promise<ResolvedSource> {
  if (episode.source) return episode.source;
  if (episode.apiReq != null) return resolveSource(episode.apiReq, net);
  if (episode.pageUrl != null) return resolvePwEpisode(episode.pageUrl, net);
  throw new Error(`Episode "${episode.title}" has no resolvable source.`);
}

/** Collects episodes from any supported episode or category/season URL. */
export async function collectEpisodesFromUrl(
  url: string,
  net: NetOptions = {},
): Promise<Episode[]> {
  const classification = classifyUrl(url);
  if (!classification) throw new Error(`Unsupported anime1 URL: ${url}`);
  if (classification.source === ANIME1_PW) {
    return classification.kind === 'episode'
      ? [await fetchPwEpisode(url, net)]
      : fetchPwEpisodes(url, net);
  }
  // anime1.me: episode and category URLs expose the same article markup.
  return fetchEpisodesFromUrl(url, net);
}
