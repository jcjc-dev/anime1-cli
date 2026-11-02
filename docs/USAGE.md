# anime1-cli usage guide

This guide covers the `anime1` command from the [anime1-cli](../README.md)
package. It is a companion to the README: the README gives the overview, this
document walks through every way to drive the tool.

`anime1` is an interactive Node.js terminal app for browsing
[anime1.me](https://anime1.me) by year and season and downloading episodes.
Everything it does, your browser already does when you visit the site; the tool
just automates it over plain HTTP. It has **no system dependencies** — no
ffmpeg, no yt-dlp, no Python. Just Node 20+.

---

## Getting started

Install it globally, or build from source (see the README). Either way you get
the `anime1` command on your `PATH`.

```sh
npm install -g anime1-cli
```

From a source checkout you can run it without installing:

```sh
npm run dev        # builds the engine, then runs the CLI from source
```

Run it with no arguments and it walks you through everything:

```sh
anime1
```

The interactive flow asks, one prompt at a time:

1. **Year** — pick a year (latest first).
2. **Season** — pick `春/夏/秋/冬` (spring/summer/autumn/winter).
3. **Series** — type to filter the list, then pick one.
4. **Episodes** — grab them all, or select specific ones (space to toggle,
   `a` = all, `i` = invert).
5. **Output directory** — where to save (default `./downloads`).

Files land in `./downloads/<series>/`, one per episode.

> If `anime1` is run from a non-interactive terminal (piped input, a script, a
> CI job) it skips the prompts entirely and relies on the flags below. A command
> that would need a choice (for example browsing with no `--year`) fails fast
> with a clear message instead of hanging.

---

## Driving it with flags

Every prompt has a flag equivalent, so you can script it:

```sh
# grab every episode of one series, non-interactively
anime1 --year 2025 --season summer --search "frieren" --all

# jump straight to a category id and download everything
anime1 --cat 6 --all --out ./anime

# print the resolved video links and cookies without downloading
anime1 --cat 6 --extract

# just print the catalogue
anime1 --list --year 2026 --season spring
```

| Flag | What it does |
| --- | --- |
| `--year <year>` | Filter by year, like `2025` |
| `--season <season>` | `spring`, `summer`, `autumn`, `winter` (or `春`, `夏`, `秋`, `冬`) |
| `--search <text>` | Filter the series list by title |
| `--cat <id>` | Jump straight to a category id (skips browsing) |
| `--all` | Take every episode, no prompts |
| `--out <dir>` | Where to save (default `./downloads`) |
| `--connections <n>` | Connections per file (default 6, max 8) |
| `--concurrency <n>` | Episodes downloaded at once (default 1, max 4) |
| `--list` | Print the catalogue and exit |
| `--extract` | Print video URLs and cookies, no download |
| `--min-interval <ms>` | Smallest gap between requests (default 250) |
| `--user-agent <ua>` | Custom User-Agent, if Cloudflare gets in the way |
| `--cf-clearance <cookie>` | `cf_clearance` cookie, if Cloudflare gets in the way |

### Searching

`--search` narrows the pool to titles containing the text, case-insensitively:

```sh
# all three do the same thing and print nothing until the downloads start
anime1 --year 2025 --season summer --search frieren --all
anime1 --year 2025 --season summer --search "Frieren" --all
anime1 --year 2025 --season summer --search "葬送のフリーレン" --all
```

If a search uniquely matches one series, that series is chosen directly. If it
matches several, the interactive run lets you pick; a non-interactive run fails
and asks you to refine the search.

### Cloudflare

anime1.me sometimes answers with an HTTP 403 Cloudflare challenge. If that
happens, open the site in your browser, copy the matching `User-Agent` and
`cf_clearance` cookie, and pass them in:

```sh
anime1 --cat 6 --all --user-agent "Mozilla/5.0 ..." --cf-clearance "eyJ..."
```

These are the only flags that depend on your browser; everything else works out
of the box.

---

## Pasting URLs

You can skip the catalogue entirely and hand the tool one or more URLs. It
accepts episode pages and whole category/season pages from both `anime1.me` and
`anime1.pw`:

```sh
# a single episode
anime1 https://anime1.me/15651
anime1 https://anime1.pw/349

# a whole category/season (every episode), into a folder
anime1 "https://anime1.pw/?cat=60" --all --out ./anime

# several at once (space- or comma-separated)
anime1 https://anime1.me/15651 https://anime1.pw/349
```

Supported sources:

| Source | Episode URL | Category / season URL | Video |
| --- | --- | --- | --- |
| `anime1.me` | `https://anime1.me/15651` | `https://anime1.me/category/...` (or `--cat <id>` / catalogue browse) | MP4 via API |
| `anime1.pw` | `https://anime1.pw/349` | `https://anime1.pw/?cat=60` or `https://anime1.pw/<slug>` | direct MP4 |

Only `anime1.me` has the JSON catalogue, so year/season browsing and `--search`
apply to it; for `anime1.pw` paste a URL.

---

## How downloads work

For every episode the tool resolves the real video URL (and, on `anime1.me`, the
short-lived `e`/`h`/`p` cookies the CDN requires), then downloads the file over
plain HTTP.

- **Segmented download.** The CDN throttles a single connection to roughly
  1 MB/s, so by default a file is fetched in several parallel byte-range
  segments and reassembled — usually several times faster. `--connections`
  tunes this (default 6, hard max 8). Small files and files with no known size
  fall back to a single resumable stream.
- **Resume.** Interrupted downloads resume instead of starting over. Partial
  files are kept as `.part` / segment files and only renamed into place once
  complete.
- **HLS.** Some episodes are `.m3u8` streams. These are downloaded too: the
  segments are fetched, decrypted (AES-128) if needed, and stitched into a
  single file with no ffmpeg. MPEG-TS streams become `.ts`; fragmented-MP4
  streams become `.mp4`.
- **Progress.** A single-line progress bar shows percentage, MB, speed, and ETA.
  It truncates to the terminal width, so long CJK titles never wrap.

`--extract` prints the resolved source URL, MIME type, whether it is HLS, and
the cookies — without downloading anything. Handy for debugging or scripting.

---

## Politeness and safety

- The catalogue (`animelist.json`) is fetched fresh on every run and kept in
  **memory only** — nothing is written to your home folder.
- Requests are spaced at least `--min-interval` ms apart (default 250), with
  exponential backoff and `Retry-After` handling, so the tool never bursts
  against the site/CDN.
- Concurrency is capped (`--concurrency` max 4, `--connections` max 8).
- Output paths are validated so a series title can never escape the output
  directory (a title like `..` is refused, and downloads stay under `--out`).

---

## Troubleshooting

**`Failed to fetch catalog (HTTP 403)`** — Cloudflare is challenging the
request. Pass `--user-agent` and `--cf-clearance` copied from your browser (see
above).

**`No downloadable series found for <year> <season>`** — the catalogue has
nothing downloadable there (all rows were adult/external). Try another
year/season or a `--search`.

**`Multiple series match`** — a non-interactive run can't choose for you.
Refine with `--search` until it matches one series, or run in an interactive
terminal.

**`anime1.me markup may have changed — the parser likely needs updating`** — the
page loaded but no recognizable episodes were found. The site markup changed;
this is a signal to update the parser, not a user error.

**Slow downloads** — raise `--connections` (to 8) and `--concurrency` (to 4).
Beware the diminishing returns past 6 connections per file.

---

## Legal

This is a personal, research tool. It does not host, store, or distribute any
media — it automates the same requests your browser already makes. How you use
it is your responsibility: follow the laws where you live, the terms of the
site, and the rights of the content creators.
