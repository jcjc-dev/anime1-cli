// A UI-agnostic download queue. It owns the list of jobs, their status/progress,
// and the concurrency-limited worker loop, but knows nothing about terminals or
// rendering — the TUI just snapshots it and redraws. The actual network work is
// injected (the CLI wires in resolve+download; tests inject a fake), so this is
// fully unit-testable.

import { resolve as pathResolve, basename, dirname, join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import type { Episode, NetOptions } from 'anime1-core';
import {
  downloadHls,
  downloadSource,
  extensionFromType,
  resolveEpisode,
  sanitizeFilename,
} from 'anime1-core';

export type JobStatus = 'queued' | 'downloading' | 'done' | 'error';

export interface QueueProgress {
  received: number;
  total: number | null;
}

export interface Job {
  id: number;
  seriesTitle: string;
  episode: Episode;
  status: JobStatus;
  progress: QueueProgress;
  error?: string;
  /** Resolved output directory for this series. */
  outDir: string;
  /** Abort controller used to cancel an in-flight download. */
  controller?: AbortController;
  /** Sanitized output base (no extension) — lets cancel() remove partial files. */
  basePath?: string;
}

export interface QueueSummary {
  queued: number;
  downloading: number;
  done: number;
  error: number;
  total: number;
}

export interface PerformContext {
  net: NetOptions;
  connections: number;
}

export interface DownloadQueueOptions extends PerformContext {
  concurrency: number;
  /** Called whenever a job's status or progress changes (drives a redraw). */
  onUpdate?: () => void;
  /** Performs the actual download for one job. Injected for testability. */
  perform?: (job: Job, report: (received: number, total: number | null) => void) => Promise<void>;
}

/** Default worker: resolve the episode and download it (MP4 or HLS). */
async function defaultPerform(
  job: Job,
  ctx: PerformContext,
  report: (received: number, total: number | null) => void,
): Promise<void> {
  const source = await resolveEpisode(job.episode, ctx.net);
  const base = pathResolve(job.outDir, sanitizeFilename(job.episode.title));
  job.basePath = base;
  const onProgress = (p: { received: number; total: number | null }): void =>
    report(p.received, p.total);
  const signal = job.controller?.signal;
  if (source.isHls) {
    await downloadHls(source, base, { net: ctx.net, connections: ctx.connections, onProgress, signal });
    return;
  }
  const outPath = `${base}.${extensionFromType(source.type)}`;
  await downloadSource(source, outPath, {
    net: ctx.net,
    connections: ctx.connections,
    onProgress,
    signal,
  });
}

/**
 * Removes leftover partial-download artifacts for a job's output base path.
 * Matches `.part`, `.assembling`, HLS `.hlsparts` directories, and segmented
 * `.p<n>` parts — never the final `.mp4`/`.ts` file, so a previously-completed
 * download is left untouched.
 */
async function cleanupPartialFiles(basePath: string): Promise<void> {
  const dir = dirname(basePath);
  const stem = basename(basePath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // output directory not created yet — nothing to clean
  }
  const pattern = /\.p\d+$|\.part$|\.assembling$|hlsparts$/;
  await Promise.all(
    entries
      .filter((name) => name.startsWith(`${stem}.`) && pattern.test(name))
      .map((name) => rm(join(dir, name), { recursive: true, force: true })),
  );
}

export class DownloadQueue {
  private readonly jobs: Job[] = [];
  private readonly options: DownloadQueueOptions;
  private nextId = 1;
  private running = 0;
  private drainPromise: Promise<void> | null = null;
  private resolveDrain: (() => void) | null = null;

  constructor(options: DownloadQueueOptions) {
    this.options = {
      ...options,
      // Bind the default worker to this queue's net/connections and adapt it to
      // the (job, report) signature the runner uses.
      perform:
        options.perform ??
        ((job: Job, report: (received: number, total: number | null) => void) =>
          defaultPerform(job, { net: options.net, connections: options.connections }, report)),
    };
  }

  get busy(): boolean {
    return (
      this.running > 0 || this.jobs.some((j) => j.status === 'queued' || j.status === 'downloading')
    );
  }

  /** Enqueues episodes (all belonging to one series) for download. */
  add(seriesTitle: string, episodes: Episode[], outDir: string): Job[] {
    const created = episodes.map((episode) => {
      const controller = new AbortController();
      return {
        id: this.nextId++,
        seriesTitle,
        episode,
        status: 'queued' as JobStatus,
        progress: { received: 0, total: null } as QueueProgress,
        outDir,
        controller,
      };
    });
    this.jobs.push(...created);
    this.kick();
    return created;
  }

  /** A snapshot of all jobs, newest first (for rendering). */
  snapshot(): Job[] {
    return [...this.jobs].reverse();
  }

  /**
   * Cancels a job. A downloading job is aborted and its partial files are
   * removed from disk; queued/finished jobs are just dropped. Previously
   * completed final files are never touched.
   */
  cancel(id: number): void {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index === -1) return;
    const job = this.jobs[index];
    if (job.status === 'downloading') {
      job.controller?.abort();
      this.jobs.splice(index, 1);
      this.running = Math.max(0, this.running - 1);
      this.options.onUpdate?.();
      this.kick();
      if (job.basePath) void cleanupPartialFiles(job.basePath);
      return;
    }
    this.jobs.splice(index, 1);
    this.options.onUpdate?.();
    if (job.basePath && job.status !== 'done') void cleanupPartialFiles(job.basePath);
  }

  summary(): QueueSummary {
    let queued = 0;
    let downloading = 0;
    let done = 0;
    let error = 0;
    for (const job of this.jobs) {
      if (job.status === 'queued') queued++;
      else if (job.status === 'downloading') downloading++;
      else if (job.status === 'done') done++;
      else error++;
    }
    return { queued, downloading, done, error, total: this.jobs.length };
  }

  /** Resolves once every enqueued job has finished (done or error). */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    if (!this.drainPromise) {
      this.drainPromise = new Promise((resolve) => {
        this.resolveDrain = resolve;
      });
    }
    return this.drainPromise;
  }

  private kick(): void {
    while (this.running < this.options.concurrency) {
      const job = this.jobs.find((j) => j.status === 'queued');
      if (!job) break;
      this.running++;
      job.status = 'downloading';
      this.options.onUpdate?.();
      this.performJob(job);
    }
    this.maybeDrain();
  }

  private performJob(job: Job): void {
    const report = (received: number, total: number | null): void => {
      job.progress = { received, total };
      this.options.onUpdate?.();
    };
    this.options
      .perform!(job, report)
      .then(() => this.finishJob(job, 'done', undefined))
      .catch((err: unknown) => this.finishJob(job, 'error', err));
  }

  /**
   * Records a finished job. Returns early (without touching counters) if the job
   * was cancelled/removed in the meantime — its slot was already freed by cancel().
   */
  private finishJob(job: Job, status: JobStatus, err: unknown): void {
    if (!this.jobs.includes(job)) return;
    if (status === 'error') job.error = err instanceof Error ? err.message : String(err);
    job.status = status;
    this.running--;
    this.options.onUpdate?.();
    this.kick();
  }

  private maybeDrain(): void {
    if (this.busy) return;
    if (this.resolveDrain) {
      const resolve = this.resolveDrain;
      this.resolveDrain = null;
      this.drainPromise = null;
      resolve();
    }
  }
}
