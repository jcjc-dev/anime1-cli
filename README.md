# anime1-cli

[![PR gate](https://github.com/jcjc-dev/anime1-cli/actions/workflows/pr-gate.yml/badge.svg)](https://github.com/jcjc-dev/anime1-cli/actions/workflows/pr-gate.yml)
[![Release](https://github.com/jcjc-dev/anime1-cli/actions/workflows/publish.yml/badge.svg)](https://github.com/jcjc-dev/anime1-cli/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/anime1-cli?label=anime1-cli)](https://www.npmjs.com/package/anime1-cli)
[![npm](https://img.shields.io/npm/v/anime1-core?label=anime1-core)](https://www.npmjs.com/package/anime1-core)
[![license](https://img.shields.io/npm/l/anime1-cli)](./LICENSE)

A command line tool for browsing [anime1.me](https://anime1.me) by year and season and downloading episodes. Written in TypeScript, runs on Node, and needs nothing else installed.

I made this because the existing options were either browser userscripts or Python scripts that pulled in yt-dlp and ffmpeg. This one only needs Node, and it lets you browse the catalogue by season instead of hunting down a URL to paste in.

## Features

- Browse the whole catalogue by year and season, newest first
- Search by title, then grab a full series or just the episodes you want
- Fast downloads that open several connections per file (the CDN throttles each connection, so this makes a real difference)
- Resumes interrupted downloads instead of starting from scratch
- A live progress bar with speed and ETA
- No ffmpeg, no yt-dlp, no Python, just Node
- Nothing is written to your home folder. The catalogue is fetched fresh each run and kept in memory

## Requirements

Node.js 20 or newer.

## Install

```sh
npm install -g anime1-cli
```

That puts an `anime1` command on your PATH. Then just run `anime1`.

If you would rather build from source:

```sh
git clone https://github.com/jcjc-dev/anime1-cli.git
cd anime1-cli
npm install
npm run build
cd packages/cli && npm link
```

Either way you end up with the `anime1` command. From a source checkout you can also run it without linking, using `npm run dev`.

## Usage

Run it with no arguments and it walks you through everything:

```sh
anime1
```

You pick a year, then a season, then the series (type to filter the list), then which episodes, then where to save them. By default files land in `./downloads/<series>`.

You can also skip the prompts and drive it with flags, which is handy in scripts:

```sh
# grab every episode of one series
anime1 --year 2025 --season summer --search "frieren" --all

# jump straight to a category id
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
| `--cat <id>` | Jump straight to a category id |
| `--all` | Take every episode, no prompts |
| `--out <dir>` | Where to save (default `./downloads`) |
| `--connections <n>` | Connections per file (default 6, max 8) |
| `--concurrency <n>` | Episodes downloaded at once (default 1, max 4) |
| `--list` | Print the catalogue and exit |
| `--extract` | Print video URLs and cookies, no download |
| `--min-interval <ms>` | Smallest gap between requests (default 250) |
| `--user-agent <ua>` | Custom User-Agent, if Cloudflare gets in the way |
| `--cf-clearance <cookie>` | `cf_clearance` cookie, if Cloudflare gets in the way |

If anime1.me ever answers with a Cloudflare challenge (an HTTP 403), copy a matching User-Agent and `cf_clearance` cookie out of your browser and pass them with `--user-agent` and `--cf-clearance`.

Streaming-only episodes (`.m3u8`) are uncommon on the site and are skipped for now rather than downloaded.

## How it works

anime1.me publishes its entire catalogue as a single JSON file, with the year and season for every title. The tool reads that, lets you pick a series, then loads the series page to find each episode. For every episode it asks the site's API for the real video URL and the short lived cookies the CDN expects, then downloads the file over plain HTTP.

A single connection to the CDN is capped at roughly 1 MB/s, so by default each file is fetched in several parallel ranges and stitched back together, which is usually several times faster. Tune it with `--connections` if you want.

## Project layout

This is an npm workspaces monorepo with two packages:

- `packages/core` (`anime1-core`) is the engine: catalogue, filtering, episode resolution and downloading. It has no UI code and no runtime dependencies, so other front ends can reuse it.
- `packages/cli` (`anime1-cli`) is the terminal app that gives you the `anime1` command.

Common tasks, all run from the repo root:

```sh
npm run dev     # run the CLI from source
npm run build   # compile both packages
npm run lint    # type check and eslint
npm test        # run the tests
```

## Releasing

The version in `package.json` drives releases. Bump it, open a PR, and once it merges the rest is automatic.

```sh
npm run version:set 0.1.2        # updates both packages, the lockfile, and the dep
git switch -c release-0.1.2
git commit -am "Release 0.1.2"
git push -u origin release-0.1.2  # then open a PR and squash-merge it once the gate is green
```

`main` is protected, so changes go through a pull request. When the version-bump PR is squash-merged, the push to `main` triggers the Release workflow: it runs lint, build, and tests, and only if they all pass does it tag the commit, publish both packages to npm with provenance, and cut a GitHub Release with generated notes. Nothing reaches npm unless the checks are green.

A prerelease version like `0.2.0-beta.1` publishes to the `beta` dist-tag instead of `latest`, so it stays out of the way of normal installs. Try it with `npm install -g anime1-cli@beta`.

## Legal

This is a personal tool. It does not host, store, or distribute any media. All it does is automate the same requests your browser already makes when you open anime1.me.

How you use it is on you. Follow the laws where you live, the terms of any site you point it at, and the rights of the people who made the content. Whether you are allowed to download a particular video is your call to make, not this project's.

The software is provided as is, with no warranty of any kind. The author is not responsible for what anyone does with it and accepts no liability for copyright claims, DMCA notices, fines, or any other damages that come out of using it. A rights complaint belongs with the person who ran the tool and saved the file, not with the code or its author. If that does not work for you, do not use it.

## License

MIT. See [LICENSE](./LICENSE).
