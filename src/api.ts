import { API_URL } from './constants.js';
import { httpRequest } from './http.js';
import type { NetOptions, ResolvedSource } from './types.js';

interface ApiResponse {
  s?: Array<{ src?: string; type?: string }>;
}

/**
 * Resolves a `data-apireq` token into a direct video source and the cookies
 * (e/h/p) the CDN requires to authorize the download.
 */
export async function resolveSource(apiReq: string, net: NetOptions = {}): Promise<ResolvedSource> {
  const res = await httpRequest(API_URL, {
    net,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `d=${apiReq}`,
  });
  if (!res.ok) {
    throw new Error(`API error (HTTP ${res.status}) while resolving video source`);
  }
  const cookies = parseSetCookies(res);
  const json = (await res.json()) as ApiResponse;
  const first = json.s?.[0];
  if (!first?.src) {
    throw new Error('API response did not contain a video source');
  }
  const src = first.src.startsWith('http') ? first.src : `https:${first.src}`;
  const type = first.type ?? '';
  const isHls = /\.m3u8(\?|$)/i.test(src) || /mpegurl/i.test(type);
  return { src, type, cookies, isHls };
}

function parseSetCookies(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}
