import { DEFAULT_MIN_REQUEST_INTERVAL_MS, DEFAULT_USER_AGENT, SITE } from './constants.js';
import type { NetOptions } from './types.js';

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

let minIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS;
let gateChain: Promise<void> = Promise.resolve();
let lastRequestStart = 0;

/** Sets the minimum spacing between outbound requests (polite rate limiting). */
export function setMinRequestInterval(ms: number): void {
  minIntervalMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

/**
 * Serializes request *scheduling* so outbound requests start at least
 * `minIntervalMs` apart, even when callers fire concurrently. This keeps the
 * tool from bursting against the site/CDN during pagination crawls or batch
 * downloads.
 */
function rateGate(): Promise<void> {
  const next = gateChain.then(async () => {
    if (minIntervalMs <= 0) {
      lastRequestStart = Date.now();
      return;
    }
    const waitMs = Math.max(0, lastRequestStart + minIntervalMs - Date.now());
    if (waitMs > 0) await delay(waitMs);
    lastRequestStart = Date.now();
  });
  gateChain = next.catch(() => undefined);
  return next;
}

/** Parses a Retry-After header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export function buildHeaders(
  net: NetOptions = {},
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': net.userAgent ?? DEFAULT_USER_AGENT,
    Referer: `${SITE}/`,
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    ...extra,
  };
  if (net.cfClearance) {
    const cf = `cf_clearance=${net.cfClearance}`;
    headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${cf}` : cf;
  }
  return headers;
}

export interface HttpOptions extends Omit<RequestInit, 'headers'> {
  net?: NetOptions;
  headers?: Record<string, string>;
  retries?: number;
}

export async function httpRequest(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { net = {}, retries = 3, headers = {}, ...init } = opts;
  const mergedHeaders = buildHeaders(net, headers);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateGate();
    try {
      const res = await fetch(url, { ...init, headers: mergedHeaders, redirect: 'follow' });
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        void res.body?.cancel();
        await delay(Math.max(retryAfter ?? 0, backoff(attempt)));
        continue;
      }
      return res;
    } catch (err) {
      // Never retry a caller-initiated abort.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < retries) {
        await delay(backoff(attempt));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Request failed: ${url}`);
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
