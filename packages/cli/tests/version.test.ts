import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/constants.js';

describe('VERSION constant', () => {
  it('matches packages/cli/package.json (no drift)', () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
