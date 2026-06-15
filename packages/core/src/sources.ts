// Source detection and URL classification for the supported anime1 family
// sites. Pure logic with no network access, so it is fully unit-testable.

export type SourceKind = 'anime1.me' | 'anime1.pw';

export const ANIME1_ME: SourceKind = 'anime1.me';
export const ANIME1_PW: SourceKind = 'anime1.pw';

export type UrlKind = 'episode' | 'category';

export interface UrlClassification {
  source: SourceKind;
  kind: UrlKind;
}

const HOSTS: Record<string, SourceKind> = {
  'anime1.me': ANIME1_ME,
  'anime1.pw': ANIME1_PW,
};

const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);

// A numeric permalink such as https://anime1.me/15651 or https://anime1.pw/349.
const EPISODE_PATH = /^\/\d+\/?$/;

// anime1.pw category slugs that are really WordPress system routes, not series.
const RESERVED_SLUGS = new Set([
  'about',
  'contact',
  'feed',
  'page',
  'privacy-policy',
  'wp-admin',
  'wp-content',
  'wp-includes',
  'wp-json',
  'wp-login',
]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Returns the supported source for a URL, or null when it is not one of ours. */
export function detectSource(url: string): SourceKind | null {
  const parsed = parse(url);
  if (!parsed || !SUPPORTED_SCHEMES.has(parsed.protocol)) return null;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return HOSTS[host] ?? null;
}

function isNumericEpisodePath(path: string): boolean {
  return EPISODE_PATH.test(path);
}

function hasNumericCategoryQuery(params: URLSearchParams): boolean {
  return params.getAll('cat').some((value) => /^\d+$/.test(value));
}

/** Whether a path can be an anime1.pw single-segment category slug. */
function isCategorySlugPath(path: string): boolean {
  const slug = path.replace(/^\/+|\/+$/g, '');
  if (!slug || slug.includes('/') || slug.includes('.')) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }
  const normalized = decoded.toLowerCase();
  if (decoded.includes('/') || normalized.startsWith('wp-')) return false;
  return !RESERVED_SLUGS.has(normalized);
}

/** Whether a URL points at a single episode page on a supported source. */
export function isEpisodeUrl(url: string): boolean {
  const parsed = parse(url);
  if (!parsed || detectSource(url) === null) return false;
  return isNumericEpisodePath(parsed.pathname);
}

/** Whether a URL points at a category/season listing on a supported source. */
export function isCategoryUrl(url: string): boolean {
  const parsed = parse(url);
  const source = detectSource(url);
  if (!parsed || source === null) return false;
  if (source === ANIME1_ME) {
    return parsed.pathname.startsWith('/category/') && parsed.pathname.length > '/category/'.length;
  }
  // anime1.pw
  if (isNumericEpisodePath(parsed.pathname)) return false;
  return hasNumericCategoryQuery(parsed.searchParams) || isCategorySlugPath(parsed.pathname);
}

/** Classifies a URL into its source and whether it is an episode or category. */
export function classifyUrl(url: string): UrlClassification | null {
  const source = detectSource(url);
  if (source === null) return null;
  if (isEpisodeUrl(url)) return { source, kind: 'episode' };
  if (isCategoryUrl(url)) return { source, kind: 'category' };
  return null;
}
