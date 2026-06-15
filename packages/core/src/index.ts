// Public API for anime1-core, the UI-agnostic engine.
// Frontends (CLI, web, desktop) compose these primitives.

export type { Anime, Episode, ResolvedSource, NetOptions } from './types.js';
export type { DownloadOptions, DownloadProgress, Segment } from './download.js';
export type { SourceKind, UrlKind, UrlClassification } from './sources.js';
export type { HlsDownloadOptions, HlsVariant, MediaPlaylist, HlsSegment, HlsKey } from './hls.js';

export { fetchCatalog } from './catalog.js';
export {
  parseAnimeRow,
  listYears,
  listSeasons,
  filterByYearSeason,
  searchByTitle,
  normalizeSeason,
} from './filter.js';
export {
  fetchEpisodes,
  fetchEpisodesFromUrl,
  parseEpisodes,
  parsePagination,
  parseEpisodeNumber,
} from './resolver.js';
export { resolveSource } from './api.js';
export { resolveEpisode, collectEpisodesFromUrl } from './resolve.js';
export {
  detectSource,
  classifyUrl,
  isEpisodeUrl,
  isCategoryUrl,
  ANIME1_ME,
  ANIME1_PW,
} from './sources.js';
export {
  resolvePwEpisode,
  fetchPwEpisode,
  fetchPwEpisodes,
  parsePwEpisodePage,
  parsePwSeasonPage,
  selectMp4Source,
} from './pw.js';
export {
  downloadHls,
  parseMasterPlaylist,
  parseMediaPlaylist,
  isMasterPlaylist,
  selectVariant,
  parseAttributes,
  parseHex,
  ivForSequence,
} from './hls.js';
export {
  downloadSource,
  planSegments,
  sanitizeFilename,
  extensionFromType,
} from './download.js';
export {
  httpRequest,
  buildHeaders,
  parseRetryAfter,
  setMinRequestInterval,
} from './http.js';
export {
  SITE,
  CATALOG_URL,
  API_URL,
  DEFAULT_USER_AGENT,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
  DEFAULT_CONNECTIONS,
  MAX_CONNECTIONS,
  MIN_SEGMENT_SIZE,
  SEASON_CHARS,
  SEASON_EN,
  SEASON_ORDER,
  SEASON_ALIAS,
} from './constants.js';
