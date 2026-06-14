import { CATALOG_URL } from './constants.js';
import { parseAnimeRow } from './filter.js';
import { httpRequest } from './http.js';
import type { Anime, NetOptions } from './types.js';

/**
 * Fetches the full anime1.me catalog (animelist.json) fresh on every call.
 * The data is held in memory only and never written to disk.
 */
export async function fetchCatalog(net: NetOptions = {}): Promise<Anime[]> {
  const res = await httpRequest(CATALOG_URL, { net });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch catalog (HTTP ${res.status}). The site may be blocking the request; ` +
        'try passing --user-agent and --cf-clearance.',
    );
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected catalog format returned by animelist.json');
  }
  return data
    .map((row) => parseAnimeRow(row as unknown[]))
    .filter((anime): anime is Anime => anime !== null);
}
