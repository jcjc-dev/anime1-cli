// Detecting which episodes are already on disk, so a re-run against an existing
// series folder can skip what's already downloaded and fetch only what's new.
// Pure logic: the filesystem probe is injected, so it is fully unit-testable.

import { join } from 'node:path';
import { sanitizeFilename } from './download.js';
import type { Episode } from './types.js';

/**
 * File extensions a downloaded episode can take. The exact one is only known
 * after the source is resolved (MP4 via API/direct, or .ts/.mp4 for HLS), so an
 * existence check before resolving considers all of them.
 */
export const CANDIDATE_EXTENSIONS = ['mp4', 'ts', 'webm', 'mkv'] as const;

/**
 * The on-disk paths an episode's downloaded file could occupy in `outDir`,
 * before its source is resolved. Mirrors how the downloader names files
 * (`<sanitized-title>.<ext>`), so the check matches what was actually written.
 */
export function episodeOutputCandidates(title: string, outDir: string): string[] {
  const base = sanitizeFilename(title);
  return CANDIDATE_EXTENSIONS.map((ext) => join(outDir, `${base}.${ext}`));
}

export interface ExistingSplit<T extends Episode> {
  /** Episodes with no file on disk yet — these still need downloading. */
  missing: T[];
  /** Episodes whose output file already exists. */
  existing: T[];
}

/**
 * Splits episodes into already-downloaded (a file exists for them) vs missing.
 * `exists` is injected so callers decide the probe (real `fs` in the CLI, a
 * fake in tests). Order is preserved within each bucket.
 */
export async function splitExisting<T extends Episode>(
  episodes: T[],
  outDir: string,
  exists: (path: string) => Promise<boolean>,
): Promise<ExistingSplit<T>> {
  const missing: T[] = [];
  const existing: T[] = [];
  for (const episode of episodes) {
    let found = false;
    for (const path of episodeOutputCandidates(episode.title, outDir)) {
      if (await exists(path)) {
        found = true;
        break;
      }
    }
    (found ? existing : missing).push(episode);
  }
  return { missing, existing };
}
