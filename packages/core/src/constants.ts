export const SITE = 'https://anime1.me';
export const CATALOG_URL = 'https://anime1.me/animelist.json';
export const API_URL = 'https://v.anime1.me/api';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Minimum spacing between outbound requests, to avoid bursting the site/CDN. */
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 250;

/** Default number of parallel connections used to download a single file. */
export const DEFAULT_CONNECTIONS = 6;

/** Hard cap on parallel connections per file. */
export const MAX_CONNECTIONS = 8;

/** Only split a file into segments when it is at least this large (bytes). */
export const MIN_SEGMENT_SIZE = 5 * 1024 * 1024;

/**
 * Safety cap on how many category pages to crawl for one series, so a malformed
 * or hostile pagination block can't drive an unbounded crawl. Surfaced to the
 * caller when hit (see fetchEpisodes) rather than silently truncating.
 */
export const MAX_CATEGORY_PAGES = 60;

export const SEASON_CHARS = ['春', '夏', '秋', '冬'] as const;

export const SEASON_EN: Record<string, string> = {
  春: 'Spring',
  夏: 'Summer',
  秋: 'Autumn',
  冬: 'Winter',
};

// Chronological order within a year (winter first, autumn last).
export const SEASON_ORDER: Record<string, number> = {
  冬: 0,
  春: 1,
  夏: 2,
  秋: 3,
};

// Accepts english names/aliases and the chinese characters themselves.
export const SEASON_ALIAS: Record<string, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  fall: '秋',
  winter: '冬',
  春: '春',
  夏: '夏',
  秋: '秋',
  冬: '冬',
};
