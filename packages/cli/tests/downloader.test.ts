import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Episode } from 'anime1-core';
import { DownloadQueue } from '../src/downloader.js';

const ep = (n: number): Episode => ({ title: `Ep [${n}]`, number: n, apiReq: `t${n}` });

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('DownloadQueue', () => {
  it('caps the number of concurrent downloads', async () => {
    let running = 0;
    let maxRunning = 0;
    const queue = new DownloadQueue({
      net: {},
      connections: 1,
      concurrency: 2,
      perform: async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      },
    });
    queue.add('Series', [ep(1), ep(2), ep(3), ep(4), ep(5)], '/o');
    await queue.idle();
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(queue.summary().done).toBe(5);
  });

  it('moves jobs queued -> downloading -> done', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const queue = new DownloadQueue({
      net: {},
      connections: 1,
      concurrency: 2,
      perform: (job) => gates[job.id - 1].promise,
    });
    queue.add('S', [ep(1), ep(2), ep(3)], '/o');
    const snapshot = queue.snapshot().reverse(); // oldest first
    expect(snapshot[0].status).toBe('downloading');
    expect(snapshot[1].status).toBe('downloading');
    expect(snapshot[2].status).toBe('queued');
    gates.forEach((g) => g.resolve());
    await queue.idle();
    expect(queue.summary().done).toBe(3);
  });

  it('records an error and still resolves idle', async () => {
    const queue = new DownloadQueue({
      net: {},
      connections: 1,
      concurrency: 1,
      perform: async () => {
        throw new Error('boom');
      },
    });
    queue.add('S', [ep(1), ep(2)], '/o');
    await queue.idle();
    const summary = queue.summary();
    expect(summary.done).toBe(0);
    expect(summary.error).toBe(2);
    expect(queue.snapshot()[0].error).toBe('boom');
  });

  it('reports progress via the report callback', async () => {
    const queue = new DownloadQueue({
      net: {},
      connections: 1,
      concurrency: 1,
      perform: async (_job, report) => {
        report(10, 100);
      },
    });
    queue.add('S', [ep(1)], '/o');
    await queue.idle();
    expect(queue.snapshot()[0].progress).toEqual({ received: 10, total: 100 });
  });

  it('snapshot returns jobs newest first', async () => {
    const queue = new DownloadQueue({
      net: {},
      connections: 1,
      concurrency: 1,
      perform: async () => {},
    });
    queue.add('S', [ep(1), ep(2), ep(3)], '/o');
    const snap = queue.snapshot();
    expect(snap.map((j) => j.id)).toEqual([3, 2, 1]);
  });

  it('idle resolves immediately when nothing is queued', async () => {
    const queue = new DownloadQueue({ net: {}, connections: 1, concurrency: 1, perform: async () => {} });
    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it('assigns per-series outDir and seriesTitle to each job', async () => {
    const queue = new DownloadQueue({ net: {}, connections: 1, concurrency: 1, perform: async () => {} });
    const jobs = queue.add('My Series', [ep(1)], '/o/My_Series');
    expect(jobs[0].seriesTitle).toBe('My Series');
    expect(jobs[0].outDir).toBe('/o/My_Series');
  });
});

describe('DownloadQueue.cancel', () => {
  it('cancels a queued job (drops it)', async () => {
    const gate = deferred();
    const queue = new DownloadQueue({ net: {}, connections: 1, concurrency: 1, perform: () => gate.promise });
    queue.add('S', [ep(1), ep(2)], '/o');
    // job 1 is downloading; job 2 is queued.
    const queued = queue.snapshot().find((j) => j.status === 'queued');
    expect(queued).toBeDefined();
    queue.cancel(queued!.id);
    expect(queue.snapshot().length).toBe(1);
    gate.resolve();
    await queue.idle();
  });

  it('aborts and removes a downloading job', async () => {
    const gate = deferred();
    const queue = new DownloadQueue({ net: {}, connections: 1, concurrency: 1, perform: () => gate.promise });
    queue.add('S', [ep(1)], '/o');
    const job = queue.snapshot()[0];
    expect(job.status).toBe('downloading');
    queue.cancel(job.id);
    expect(queue.snapshot().length).toBe(0);
    expect(job.controller?.signal.aborted).toBe(true);
    gate.resolve();
    await queue.idle();
  });
});

describe('DownloadQueue partial cleanup', () => {
  it('removes partial files for a cancelled downloading job but keeps the final file', async () => {
    const dir = mkdtempSync(join(import.meta.dirname, '..', '.tmp-cleanup-'));
    try {
      const stem = join(dir, 'Show 1');
      const finalMp4 = `${stem}.mp4`;
      const part = `${stem}.mp4.part`;
      const seg = `${stem}.mp4.t100.c6.p0`;
      const assembling = `${stem}.mp4.assembling`;
      const hlsparts = `${stem}.hlsparts`;
      writeFileSync(finalMp4, 'complete');
      writeFileSync(part, 'x');
      writeFileSync(seg, 'x');
      writeFileSync(assembling, 'x');
      mkdirSync(hlsparts);

      const gate = deferred();
      const queue = new DownloadQueue({ net: {}, connections: 1, concurrency: 1, perform: () => gate.promise });
      queue.add('S', [ep(1)], dir);
      const job = queue.snapshot()[0];
      job.basePath = stem; // simulate that the download started
      queue.cancel(job.id);
      gate.resolve();
      await queue.idle();
      await new Promise((r) => setTimeout(r, 20)); // let async cleanup finish

      expect(existsSync(part)).toBe(false);
      expect(existsSync(seg)).toBe(false);
      expect(existsSync(assembling)).toBe(false);
      expect(existsSync(hlsparts)).toBe(false);
      expect(existsSync(finalMp4)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
