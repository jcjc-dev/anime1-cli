# AGENTS.md

Guidance for AI coding agents (GitHub Copilot, Codex, and similar tools) working
in this repository. Keep changes consistent with the conventions and the hard
requirements below.

## Project

`anime1-cli` is an interactive Node.js + TypeScript CLI that browses
[anime1.me](https://anime1.me) by year and season and downloads episodes. It is
**self-contained**: it depends only on Node.js and a couple of npm packages — no
external system binaries. The CLI command is `anime1` (`bin` → `dist/cli.js`).

This tool is for **research and experimentation only** (see the README
disclaimer). Do not add features that host/redistribute content or circumvent
access controls.

## Setup, build, and checks

- Requires **Node.js >= 20**.
- Install dependencies: `npm install`
- Build (TypeScript → `dist/`): `npm run build`
- Run from source: `npm run dev` (uses `tsx`)
- Lint (type-check + eslint): `npm run lint`
- Tests (vitest): `npm test`

Always run `npm run lint` and `npm test` before finishing a change. Run
`npm run build` afterward so the globally linked `anime1` command stays current
(`npm link` points at `dist/`). Prefer fixing the root cause over silencing
type/lint errors.

## Hard requirements (do not break these)

1. **No system dependencies.** Never shell out to `ffmpeg`, `yt-dlp`, Python, or
   any other external binary. Downloads are plain authenticated HTTP requests in
   pure Node. npm packages are acceptable; tools the end user must install
   separately are not.
2. **Never cache the catalog to disk.** `animelist.json` must be fetched fresh on
   every run and held in memory only. Do not write catalog/data files to the
   user's home directory or anywhere on disk.
3. **Stay a good citizen toward the site/CDN.** Preserve the polite networking in
   `http.ts`: the min-interval rate gate, exponential backoff, and `Retry-After`
   handling. Keep the caps (`MAX_CONCURRENCY`, `MAX_CONNECTIONS`). Do not
   introduce bursty or aggressive defaults.
4. **Keep runtime dependencies minimal.** Prefer Node built-ins (`fetch`,
   `node:fs`, `node:stream`, `node:readline`) over adding packages. Current
   runtime deps: `commander` and `@inquirer/prompts` only.

## Architecture (`src/`)

- `cli.ts` — entry point / `bin`; `commander` flag parsing and orchestration.
- `catalog.ts` — `fetchCatalog()`: GET `animelist.json` (in memory only).
- `filter.ts` — parse catalog rows; group/sort by year + season (latest first);
  split compound year/season values.
- `resolver.ts` — `fetchEpisodes(catId)`: load `?cat=<id>` pages, follow
  pagination, parse each episode's `data-apireq`.
- `api.ts` — `resolveSource(apiReq)`: POST to `v.anime1.me/api`; returns the MP4
  URL and the short-lived `e`/`h`/`p` cookies the CDN requires.
- `download.ts` — segmented multi-connection download with resume; falls back to
  a single resumable stream when size is unknown or small.
- `prompts.ts` — `@inquirer/prompts` interactive flows.
- `ui.ts` — spinner and the in-place progress bar (speed/ETA, width-aware
  truncation so long CJK titles never wrap).
- `http.ts` — shared `fetch` wrapper: browser headers, retries, `Retry-After`,
  and the global rate gate.
- `constants.ts`, `types.ts` — shared constants and types.

## How the download flow works

1. `animelist.json` → full catalog rows
   `[catId, title, episodes, year, season, subGroup]`.
2. `?cat=<catId>` category page(s) → per-episode `data-apireq` tokens
   (long series paginate via `/category/.../page/N`).
3. POST `d=<apireq>` to `https://v.anime1.me/api` → direct MP4 `src` plus the
   `e`/`h`/`p` cookies (the CDN returns 403 without them; `p` is a path-scoped,
   ~8h JWT).
4. Download the MP4 over HTTP. The CDN throttles each connection (~1.2 MB/s), so
   the file is fetched in parallel byte-range segments and reassembled.
   Benchmarks show near-linear scaling to ~6 connections, then diminishing
   returns — hence `DEFAULT_CONNECTIONS = 6`, `MAX_CONNECTIONS = 8`.

## Code style and conventions

- **ESM with `NodeNext`**: relative imports must include the `.js` extension
  (e.g. `import { httpRequest } from './http.js'`).
- `verbatimModuleSyntax` is enabled: use `import type { ... }` for type-only
  imports.
- TypeScript is strict (`noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, etc.).
- Only comment code that genuinely needs clarification; avoid narrating obvious
  code.
- Terminal output that updates in place must stay on a single line and be
  width-aware (see `ui.ts`); never assume ASCII-only widths (CJK = 2 columns).

## Testing conventions

- Unit tests live in `tests/*.test.ts` (vitest) and cover **pure logic**:
  catalog/row parsing, year/season grouping, pagination parsing, segment
  planning, and the progress/format helpers.
- Network-dependent code (`catalog`/`api`/`resolver`/`download` HTTP) is not unit
  tested; when verification is needed, exercise it against the live site and
  delete any downloaded files afterward.
- Add or update tests whenever you change pure logic.

## Git conventions

- Do **not** add `Co-authored-by` AI trailers to commits (the repo owner's hook
  strips them).
- Keep `.gitignore` excluding `node_modules/`, `dist/`, `coverage/`,
  `downloads/`, and partial-download files (`*.part` and segment files).
