export interface Anime {
  /** Category id used to build `?cat=<catId>`. 0 for non-downloadable (adult/external) rows. */
  catId: number;
  title: string;
  /** Raw episode string, e.g. "1-13" or "連載中(12)". */
  episodes: string;
  /** Years this title belongs to (compound values are split), e.g. ["2025", "2026"]. */
  years: string[];
  /** Season characters this title belongs to (春/夏/秋/冬). */
  seasons: string[];
  /** Subtitle group, may be empty. */
  subGroup: string;
  /** True for 🔞 / external rows that cannot be downloaded via `?cat=`. */
  adult: boolean;
  rawYear: string;
  rawSeason: string;
}

export interface Episode {
  title: string;
  /** Parsed episode number from a trailing "[NN]" marker, if present. */
  number: number | null;
  /**
   * anime1.me locator: the URL-encoded `data-apireq` attribute posted to the
   * API. Present for catalog/`?cat=` episodes.
   */
  apiReq?: string;
  /**
   * Page-based locator (e.g. anime1.pw): the episode page URL whose markup
   * exposes a direct video source.
   */
  pageUrl?: string;
  /**
   * Pre-resolved source, when collecting a single episode already fetched its
   * page. Lets the downloader skip a redundant round trip.
   */
  source?: ResolvedSource;
}

export interface ResolvedSource {
  /** Absolute https URL to the video file. */
  src: string;
  /** MIME type reported by the API, e.g. "video/mp4". */
  type: string;
  /** Cookies (e/h/p) required to authorize the download. */
  cookies: Record<string, string>;
  /** True when the source is an HLS playlist rather than a direct file. */
  isHls: boolean;
}

export interface NetOptions {
  /** Override the default browser User-Agent (helps bypass Cloudflare). */
  userAgent?: string;
  /** cf_clearance cookie value (helps bypass Cloudflare). */
  cfClearance?: string;
}
