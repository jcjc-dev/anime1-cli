// Kept in lockstep with packages/cli/package.json by scripts/set-version.mjs.
// The version.test.ts guard fails the build if these ever drift.
export const VERSION = '0.1.1';

/** Hard cap on the number of episodes downloaded in parallel. */
export const MAX_CONCURRENCY = 4;
