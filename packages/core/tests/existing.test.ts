import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_EXTENSIONS,
  episodeOutputCandidates,
  splitExisting,
} from '../src/existing.js';
import type { Episode } from '../src/types.js';

const ep = (title: string): Episode => ({ title, number: null });

describe('episodeOutputCandidates', () => {
  it('builds one path per candidate extension under the output dir', () => {
    const dir = join('out', 'series');
    const paths = episodeOutputCandidates('葬送のフリーレン [1]', dir);
    expect(paths).toEqual([
      join(dir, '葬送のフリーレン [1].mp4'),
      join(dir, '葬送のフリーレン [1].ts'),
      join(dir, '葬送のフリーレン [1].webm'),
      join(dir, '葬送のフリーレン [1].mkv'),
    ]);
    expect(paths).toHaveLength(CANDIDATE_EXTENSIONS.length);
  });

  it('sanitizes the title exactly like the downloader names files', () => {
    // '/' and invalid chars are replaced, matching sanitizeFilename.
    const [mp4] = episodeOutputCandidates('a/b:c?* [2]', '.');
    expect(mp4.endsWith('a_b_c__ [2].mp4')).toBe(true);
  });
});

describe('splitExisting', () => {
  const exists = (present: Set<string>) => async (path: string) => present.has(path);

  it('keeps every episode missing when nothing exists', async () => {
    const episodes = [ep('A [1]'), ep('B [2]')];
    const { missing, existing } = await splitExisting(episodes, '/o', exists(new Set()));
    expect(missing).toEqual(episodes);
    expect(existing).toEqual([]);
  });

  it('moves episodes whose file exists into the existing bucket', async () => {
    const episodes = [ep('A [1]'), ep('B [2]')];
    const present = new Set([episodeOutputCandidates('A [1]', '/o')[0]]);
    const { missing, existing } = await splitExisting(episodes, '/o', exists(present));
    expect(missing.map((e) => e.title)).toEqual(['B [2]']);
    expect(existing.map((e) => e.title)).toEqual(['A [1]']);
  });

  it('recognizes an existing HLS .ts output as already downloaded', async () => {
    const episodes = [ep('Long [3]')];
    const present = new Set([episodeOutputCandidates('Long [3]', '/o')[1]]); // .ts
    const { missing, existing } = await splitExisting(episodes, '/o', exists(present));
    expect(missing).toEqual([]);
    expect(existing).toHaveLength(1);
  });

  it('preserves original order within each bucket', async () => {
    const episodes = [ep('B [2]'), ep('A [1]'), ep('C [3]')];
    const present = new Set([episodeOutputCandidates('A [1]', '/o')[0]]);
    const { missing, existing } = await splitExisting(episodes, '/o', exists(present));
    expect(missing.map((e) => e.title)).toEqual(['B [2]', 'C [3]']);
    expect(existing.map((e) => e.title)).toEqual(['A [1]']);
  });
});
