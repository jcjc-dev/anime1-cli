import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Parses and validates the --min-interval flag (milliseconds between requests).
 * Throws on non-numeric or negative input rather than silently disabling the
 * polite rate gate (Number('250ms') is NaN, which the engine would treat as 0).
 */
export function parseMinInterval(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`--min-interval must be a non-negative number of milliseconds (got "${raw}").`);
  }
  return ms;
}

/**
 * Resolves the effective base output directory. An empty or whitespace-only
 * value falls back to the default instead of resolving to the filesystem root.
 */
export function resolveBaseDir(out: string | undefined, fallback: string): string {
  const trimmed = out?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Joins a (already sanitized) series subdirectory under base and asserts the
 * result stays within base. Defense-in-depth against a path-escaping segment.
 */
export function resolveSeriesDir(base: string, sub: string): string {
  const root = resolve(base);
  if (!sub) return root;
  if (isAbsolute(sub) || sub === '.' || sub === '..') {
    throw new Error(`Refusing unsafe output subdirectory "${sub}".`);
  }
  const full = resolve(root, sub);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Refusing output path outside "${root}".`);
  }
  return full;
}

/** Splits positional URL arguments that may be comma- or whitespace-separated. */
export function splitUrlArgs(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[,\s]+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Derives a series folder name for URL-driven downloads: the first episode
 * title with a trailing "[NN]" marker removed, else the last URL path segment.
 * Returns "" when nothing usable can be derived (caller saves into the base).
 */
export function deriveSeriesName(titles: string[], fallbackUrl: string): string {
  for (const title of titles) {
    const stripped = title.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    if (stripped) return stripped;
  }
  try {
    const segment = new URL(fallbackUrl).pathname.split('/').filter(Boolean).pop();
    if (segment) return decodeURIComponent(segment);
  } catch {
    // Unparseable URL: fall through to the empty default.
  }
  return '';
}
