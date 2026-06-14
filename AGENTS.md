# AGENTS.md

Guidance for AI coding agents (GitHub Copilot, Codex, and similar tools) working
in this repository. Keep changes consistent with the conventions and the hard
requirements below.

## Project

`anime1-cli` is an interactive Node.js + TypeScript CLI that browses
[anime1.me](https://anime1.me) by year and season and downloads episodes. It is
**self-contained**: it depends only on Node.js and a couple of npm packages: no
external system binaries.

This is an **npm-workspaces monorepo** with two packages:

- **`anime1-core`** (`packages/core`): the UI-agnostic engine (catalog, filter,
  resolver, api, download, http). No CLI/UI dependencies. Reusable by any
  frontend (CLI, web, desktop).
- **`anime1-cli`** (`packages/cli`): the terminal frontend (`bin` → `anime1`):
  `commander`, `@inquirer/prompts`, the progress UI, and orchestration. Depends
  on `anime1-core`.

This tool is for **research and experimentation only** (see the README
disclaimer). Do not add features that host/redistribute content or circumvent
access controls.

## Setup, build, and checks

Run these from the **repo root** (they fan out to the workspaces):

- Requires **Node.js >= 20**.
- Install dependencies: `npm install`
- Build (core, then cli): `npm run build`
- Run from source: `npm run dev` (builds core, then runs the CLI via `tsx`)
- Lint (type-check + eslint): `npm run lint`
- Tests (vitest, all packages): `npm test`

`packages/core` must be built before `packages/cli` typechecks/builds, because
the CLI consumes the engine's compiled types via `anime1-core`; the root
scripts handle that ordering. Always run `npm run lint` and `npm test` before
finishing a change. After building, the globally linked `anime1` command
(`npm link` from `packages/cli`) stays current. Prefer fixing the root cause
over silencing type/lint errors.

## Hard requirements (do not break these)

1. **No system dependencies.** Never shell out to `ffmpeg`, `yt-dlp`, Python, or
   any other external binary. Downloads are plain authenticated HTTP requests in
   pure Node. npm packages are acceptable; tools the end user must install
   separately are not.
2. **Never cache the catalog to disk.** `animelist.json` must be fetched fresh on
   every run and held in memory only. Do not write catalog/data files to the
   user's home directory or anywhere on disk.
3. **Stay a good citizen toward the site/CDN.** Preserve the polite networking in
   `packages/core/src/http.ts`: the min-interval rate gate, exponential backoff,
   and `Retry-After` handling. Keep the caps (`MAX_CONNECTIONS` in core,
   `MAX_CONCURRENCY` in the CLI). Do not introduce bursty or aggressive defaults.
4. **Keep runtime dependencies minimal.** Prefer Node built-ins (`fetch`,
   `node:fs`, `node:stream`, `node:readline`) over adding packages. `anime1-core`
   has **zero** runtime deps; the CLI's only runtime deps are `commander` and
   `@inquirer/prompts`.
5. **Respect the package boundary.** `anime1-core` must never import from the CLI
   or any UI library. The CLI imports the engine via the `anime1-core` package
   entry (`packages/core/src/index.ts`), not by deep-importing core internals.

## Architecture

### `packages/core`: `anime1-core` (engine, UI-agnostic)

- `index.ts`: public API barrel; the only entry frontends should import.
- `catalog.ts`: `fetchCatalog()`: GET `animelist.json` (in memory only).
- `filter.ts`: parse catalog rows; group/sort by year + season (latest first);
  split compound year/season values; `normalizeSeason()`.
- `resolver.ts`: `fetchEpisodes(catId)`: load `?cat=<id>` pages, follow
  pagination, parse each episode's `data-apireq`.
- `api.ts`: `resolveSource(apiReq)`: POST to `v.anime1.me/api`; returns the MP4
  URL and the short-lived `e`/`h`/`p` cookies the CDN requires.
- `download.ts`: segmented multi-connection download with resume; falls back to
  a single resumable stream when size is unknown or small.
- `http.ts`: shared `fetch` wrapper: browser headers, retries, `Retry-After`,
  and the global rate gate.
- `constants.ts`, `types.ts`: engine constants and shared types.

### `packages/cli`: `anime1-cli` (terminal frontend)

- `cli.ts`: entry point / `bin`; `commander` flag parsing and orchestration.
- `prompts.ts`: `@inquirer/prompts` interactive flows.
- `ui.ts`: spinner and the in-place progress bar (speed/ETA, width-aware
  truncation so long CJK titles never wrap).
- `constants.ts`: CLI-only constants (`VERSION`, `MAX_CONCURRENCY`).

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
   returns: hence `DEFAULT_CONNECTIONS = 6`, `MAX_CONNECTIONS = 8`.

## Code style and conventions

- **ESM with `NodeNext`**: relative imports must include the `.js` extension
  (e.g. `import { httpRequest } from './http.js'`). The CLI imports the engine
  from the bare specifier `anime1-core`.
- `verbatimModuleSyntax` is enabled: use `import type { ... }` for type-only
  imports.
- TypeScript is strict (`noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, etc.).
- When you add a new public engine export, re-export it from
  `packages/core/src/index.ts`.
- Only comment code that genuinely needs clarification; avoid narrating obvious
  code.
- Terminal output that updates in place must stay on a single line and be
  width-aware (see `packages/cli/src/ui.ts`); never assume ASCII-only widths
  (CJK = 2 columns).

## Testing conventions

- Unit tests live in each package's `tests/*.test.ts` (vitest) and cover **pure
  logic**: catalog/row parsing, year/season grouping, pagination parsing, and
  segment planning live in `packages/core`; the progress/format helpers live in
  `packages/cli`. The CLI's vitest config aliases `anime1-core` to the engine
  source, so CLI tests run without a build.
- Network-dependent code (`catalog`/`api`/`resolver`/`download` HTTP) is not unit
  tested; when verification is needed, exercise it against the live site and
  delete any downloaded files afterward.
- Add or update tests whenever you change pure logic.

## Making changes

`main` is protected, so every change goes through a pull request, and each change
is made in its own git worktree branched off the latest remote `main`. Do not
edit on `main` directly and do not switch branches in place in the primary
checkout.

Start every change by pulling the latest remote `main` and branching a worktree
off it:

```sh
git fetch origin
git worktree add -b <branch> ../anime1-cli-<branch> origin/main
cd ../anime1-cli-<branch>
npm ci
```

Branching off `origin/main` (after `git fetch`) is required, so the work always
starts from the latest pushed state, not from whatever the primary checkout
happens to be on. Make the edits there, then commit and push the branch:

```sh
git commit -am "<message>"
git push -u origin <branch>
```

Open a pull request and squash-merge it once the `PR gate passed` check is green
(no approval is required). After it merges, clean up the worktree:

```sh
git worktree remove ../anime1-cli-<branch>
```

## Git conventions

- Do **not** add `Co-authored-by` AI trailers to commits (the repo owner's hook
  strips them).
- Keep `.gitignore` excluding `node_modules/`, `dist/`, `coverage/`,
  `downloads/`, and partial-download files (`*.part` and segment files).
- `main` is protected: pull requests are required (no direct pushes), no force
  pushes, no deletions, linear history, and merges are squash-only. A PR can be
  self-merged once the `PR gate passed` check is green; no approval is required.
  Do not rewrite published history.

## Releasing

Releases are driven by the version in the root `package.json` and run through
`.github/workflows/publish.yml` (the "Release" workflow). Do not publish to npm
by hand.

To cut a release:

1. `npm run version:set 0.1.2` (or a prerelease like `0.2.0-beta.1`). This bumps
   the root, `anime1-core`, and `anime1-cli` versions, updates the cli's
   `anime1-core` dependency, and syncs the lockfile.
2. Commit on a branch, push, open a PR, and squash-merge it once the PR gate is
   green (`main` is protected, so this cannot be pushed directly).
3. The squash-merge pushes the version bump to `main`, which the Release
   workflow detects. If no matching tag exists it runs `validate`
   (lint + build + test), then tags, publishes both packages to npm with
   provenance, and creates a GitHub Release. Nothing is published unless
   validation passes.

Notes:

- The two packages are versioned in lockstep; keep all three `package.json`
  versions equal (the publish job fails fast if they drift).
- A prerelease version (a hyphen in the semver) publishes to the npm `beta`
  dist-tag instead of `latest`.
- `anime1-core` publishes before `anime1-cli` because the cli depends on it.
- The npm trusted publisher (OIDC) is bound to the filename `publish.yml` and an
  empty environment. Renaming the workflow or adding a job `environment:` breaks
  publishing until the trusted publisher config is updated on npmjs.com.
- `pr-gate.yml` runs lint + build + test on every PR and push across an
  OS/Node matrix; keep it green.

