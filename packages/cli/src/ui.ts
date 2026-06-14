import { clearLine, cursorTo } from 'node:readline';

export interface Spinner {
  start: () => void;
  stop: (final?: string) => void;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createSpinner(text: string): Spinner {
  const enabled = process.stdout.isTTY === true;
  let index = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (!enabled) {
        process.stdout.write(`${text}\n`);
        return;
      }
      timer = setInterval(() => {
        index = (index + 1) % FRAMES.length;
        cursorTo(process.stdout, 0);
        process.stdout.write(`${FRAMES[index]} ${text}`);
        clearLine(process.stdout, 1);
      }, 80);
    },
    stop(final?: string) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (enabled) {
        cursorTo(process.stdout, 0);
        clearLine(process.stdout, 0);
      }
      if (final) process.stdout.write(`${final}\n`);
    },
  };
}

export function renderProgress(received: number, total: number | null): string {
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
  if (!total) return `${mb(received)} MB`;
  const pct = Math.min(100, (received / total) * 100);
  const width = 24;
  const filled = Math.round((pct / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${pct.toFixed(1)}%  ${mb(received)}/${mb(total)} MB`;
}

/** Formats a duration in seconds as m:ss or h:mm:ss. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Formats a transfer rate (bytes per second) as a human-readable string. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  const mbps = bytesPerSecond / 1024 / 1024;
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

/** Approximate terminal column width of a single code point (CJK = 2). */
function charWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** Truncates a string so its rendered width does not exceed `max` columns. */
export function truncateToWidth(text: string, max: number): string {
  let width = 0;
  let out = '';
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (width + cw > max) break;
    width += cw;
    out += ch;
  }
  return out;
}

export interface ProgressBar {
  update: (received: number, total: number | null) => void;
  finish: (message: string) => void;
  clear: () => void;
}

/**
 * A single-line, in-place progress indicator. It rewrites the same terminal
 * line on each update and truncates to the terminal width so long (CJK) titles
 * never wrap and spam new lines. A short refresh interval keeps it smooth
 * without redrawing on every network chunk. On non-TTY output it renders
 * nothing (callers print plain status lines instead).
 */
export function createProgressBar(label: string, minIntervalMs = 100): ProgressBar {
  const tty = process.stdout.isTTY === true;
  let lastRender = 0;
  const samples: Array<{ t: number; b: number }> = [];

  const reset = (): void => {
    cursorTo(process.stdout, 0);
    clearLine(process.stdout, 0);
  };

  const speedAndEta = (received: number, total: number | null, now: number): string => {
    samples.push({ t: now, b: received });
    const cutoff = now - 2000;
    while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
    const span = now - samples[0].t;
    const bytesPerSecond = span > 0 ? ((received - samples[0].b) / span) * 1000 : 0;
    const speed = formatSpeed(bytesPerSecond);
    let eta = '';
    if (total != null && bytesPerSecond > 0 && received < total) {
      eta = `ETA ${formatDuration((total - received) / bytesPerSecond)}`;
    }
    return [speed, eta].filter(Boolean).join('  ');
  };

  return {
    update(received, total) {
      if (!tty) return;
      const now = Date.now();
      const complete = total != null && received >= total;
      if (!complete && now - lastRender < minIntervalMs) return;
      lastRender = now;
      const cols = Math.max(10, (process.stdout.columns ?? 80) - 1);
      const extra = speedAndEta(received, total, now);
      const progress = extra
        ? `${renderProgress(received, total)}  ${extra}`
        : renderProgress(received, total);
      const separator = '  ';
      // Keep the progress bar/percentage visible; truncate the (possibly long,
      // CJK) label to whatever room is left so the line never wraps.
      const room = cols - displayWidth(progress) - separator.length;
      const line =
        room > 0
          ? `${truncateToWidth(label, room)}${separator}${progress}`
          : truncateToWidth(progress, cols);
      reset();
      process.stdout.write(line);
    },
    finish(message) {
      if (tty) reset();
      const cols = Math.max(10, (process.stdout.columns ?? 80) - 1);
      process.stdout.write(`${truncateToWidth(message, cols)}\n`);
    },
    clear() {
      if (tty) reset();
    },
  };
}
