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
