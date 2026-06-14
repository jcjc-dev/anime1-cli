#!/usr/bin/env node
// Sets the release version across the monorepo in one shot:
// root, packages/core, packages/cli, the cli's anime1-core dependency, and the
// lockfile. After running this, commit and push: the Release workflow detects
// the changed root package.json version and publishes.
//
// Usage:
//   node scripts/set-version.mjs 0.1.2
//   node scripts/set-version.mjs 0.2.0-beta.1

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <version>   e.g. 0.1.2 or 0.2.0-beta.1');
  process.exit(1);
}

const isPrerelease = version.includes('-');
const coreDep = isPrerelease ? version : `^${version}`;

function patch(path, mutate) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  mutate(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`updated ${path}`);
}

patch('package.json', (p) => {
  p.version = version;
});
patch('packages/core/package.json', (p) => {
  p.version = version;
});
patch('packages/cli/package.json', (p) => {
  p.version = version;
  p.dependencies['anime1-core'] = coreDep;
});

// Keep the CLI's VERSION constant in lockstep with the package version so
// `anime1 --version` is always correct (version.test.ts enforces this).
const constantsPath = 'packages/cli/src/constants.ts';
const constantsSrc = readFileSync(constantsPath, 'utf8');
const nextConstants = constantsSrc.replace(
  /export const VERSION = '[^']*';/,
  `export const VERSION = '${version}';`,
);
if (nextConstants === constantsSrc) {
  console.error(`Could not find the VERSION constant to update in ${constantsPath}`);
  process.exit(1);
}
writeFileSync(constantsPath, nextConstants);
console.log(`updated ${constantsPath}`);

console.log('syncing package-lock.json...');
execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
});

console.log(`\nVersion set to ${version}. Next:`);
console.log(`  git add -A && git commit -m "Release ${version}" && git push origin main`);
console.log('The Release workflow will validate, tag, publish to npm, and create the GitHub Release.');
