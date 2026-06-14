# anime1-cli

An interactive command-line tool to browse [anime1.me](https://anime1.me) by
**year and season** and download episodes — written in TypeScript, distributed
on npm, and **self-contained**.

> **For research and experimentation only.** This project is an independent,
> unofficial tool and is not affiliated with anime1.me. See the
> [Disclaimer](#disclaimer) before using it.

- **No system dependencies.** Videos are served as direct MP4 files, so
  downloads are plain authenticated HTTP requests. There is **no need** for
  `ffmpeg`, `yt-dlp`, Python, or any other external tool — just Node.js.
- **Nothing is cached to disk.** The catalog is fetched fresh on every run and
  kept in memory only; no data files are written to your home directory.

## Requirements

- Node.js 20 or later

## Install

```sh
npm install -g anime1-cli
anime1 --help
```

Or run without installing:

```sh
npx anime1-cli
```

## Usage

### Interactive (default)

Just run the command and follow the prompts:

```sh
anime1
```

You will be guided through:

1. **Year** — newest first.
2. **Season** — 春 Spring / 夏 Summer / 秋 Autumn / 冬 Winter (only the seasons
   present that year, latest first).
3. **Series** — a searchable list; start typing to filter by title.
4. **Episodes** — all of them, or pick specific ones.
5. **Output directory** — defaults to `./downloads`.

Each episode is saved as `<output>/<series>/<episode>.mp4` with a live progress
bar, and partial downloads resume automatically if interrupted.

### Non-interactive flags

The same flow can be driven entirely from flags, which is handy for scripting
and automation — no prompts are shown:

```sh
# Download every episode of one series into ./anime
anime1 --year 2025 --season summer --search "frieren" --all --out ./anime

# Jump straight to a known category id and grab everything
anime1 --cat 6 --all --out ./anime

# Just print resolved video URLs + cookies (no download)
anime1 --cat 6 --extract

# Browse the catalog as text
anime1 --list --year 2026 --season spring
```

To run fully non-interactively you must give the tool enough to pick a series
without asking, either:

- `--cat <id>` (most direct — no year/season needed), or
- `--year` + `--season`, plus `--search` when that season has more than one
  title (the search must narrow it to a single series).

Add `--all` to take every episode, or `--extract` to only print URLs. When
output is piped (not a TTY), the tool automatically selects all episodes. Use
`--out`, `--concurrency`, and `--min-interval` to control where and how fast it
downloads.

| Flag | Description |
| --- | --- |
| `--year <year>` | Filter by year, e.g. `2025`. |
| `--season <season>` | `spring`/`summer`/`autumn`/`winter` or `春`/`夏`/`秋`/`冬`. |
| `--search <text>` | Filter series by title text. |
| `--cat <id>` | Jump straight to a category id, skipping browsing. |
| `--all` | Download all episodes without prompting. |
| `--out <dir>` | Output directory (default `./downloads`). |
| `--list` | Print the catalog (respects the filters above) and exit. |
| `--extract` | Print resolved video URLs and cookies instead of downloading. |
| `--concurrency <n>` | Number of episodes downloaded in parallel (default `1`, capped at `4`). |
| `--connections <n>` | Parallel connections per episode for faster downloads (default `6`, capped at `8`). |
| `--min-interval <ms>` | Minimum delay between requests for polite rate limiting (default `250`). |
| `--user-agent <ua>` | Custom User-Agent (helps bypass Cloudflare). |
| `--cf-clearance <cookie>` | `cf_clearance` cookie value (helps bypass Cloudflare). |

## How it works

1. Fetch `https://anime1.me/animelist.json` — the complete catalog (≈1,800
   titles) in a single request, with year and season for every title.
2. For the chosen series, load its category page (`?cat=<id>`), following
   pagination for long-running shows, and read each episode's `data-apireq`.
3. POST that token to `https://v.anime1.me/api` to get the direct MP4 URL and
   the short-lived cookies the CDN requires.
4. Download the MP4 to disk. The CDN throttles each connection to roughly
   1 MB/s, so by default the file is fetched in several parallel range segments
   (`--connections`, default 6) and reassembled — several times faster than a
   single stream — while a live progress bar shows percentage, size, **speed,
   and ETA**. Partial downloads resume where they left off.

## Site protection & being a good citizen

anime1.me is protected on two layers, and this tool is built to stay well
within them rather than work around them:

- **Cloudflare** fronts the website (catalog and category pages). If you hit a
  challenge (HTTP 403), pass `--user-agent` and `--cf-clearance` (see below).
- **Signed-cookie protection** guards the video edge. The API returns short-lived
  cookies (`e`/`h`/`p`, where `p` is a path-scoped JWT valid ~8 hours). They only
  authorize the one file they were issued for; without them the CDN returns 403.

To avoid hammering the site, the client:

- spaces all outbound requests at least `--min-interval` milliseconds apart
  (default 250 ms), even when downloads run in parallel, so it never bursts;
- caps `--concurrency` at 4 regardless of what you ask for;
- retries transient failures with exponential backoff and honors the server's
  `Retry-After` header on `429`/`503` responses;
- defaults to sequential downloads with resume support, so an interrupted run
  re-fetches only the missing bytes instead of starting over.

### Bypassing a Cloudflare challenge

If a request is blocked (HTTP 403), pass a matching browser User-Agent and
`cf_clearance` cookie copied from your browser:

```sh
anime1 --user-agent "Mozilla/5.0 ..." --cf-clearance "<cookie value>"
```

## Development

```sh
npm install
npm run dev      # run from source with tsx
npm run build    # compile TypeScript to dist/
npm run lint     # type-check + eslint
npm test         # run unit tests (vitest)
```

## Notes

- HLS (`.m3u8`) sources are rare on anime1.me and are not downloaded yet; such
  episodes are reported and skipped.
- Please use this tool responsibly and respect the source site.

## Disclaimer

This project is provided **for research, educational, and experimentation
purposes only**.

- It is an **independent, unofficial** tool. It is **not affiliated with,
  endorsed by, or sponsored by** anime1.me, its operators, or any content
  owners or rights holders.
- It does **not host, store, distribute, or circumvent access controls on** any
  content. It only automates the same publicly reachable HTTP requests a normal
  web browser makes, and the upstream site may change or break it at any time
  without notice.
- **You are solely responsible** for how you use this tool, including ensuring
  your use complies with all applicable laws, the source site's Terms of
  Service, and the rights of copyright holders. Downloading or redistributing
  copyrighted material without permission may be illegal in your jurisdiction.
- The software is provided **"as is", without warranty of any kind**, express or
  implied. To the maximum extent permitted by law, the authors and contributors
  **accept no liability** for any claim, damages, or other liability arising
  from its use. **Use at your own risk.**

## License

Released under the [MIT License](./LICENSE).

