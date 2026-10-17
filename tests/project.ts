import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A temporary project directory whose package.json turns markup and components on, as a project
 * with components does: they are off by default (src/config.ts).
 */
export function markupProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ rook: { markup: true } }));

  return dir;
}

/**
 * A temporary ES module project whose built code finds "rooklang/runtime": its node_modules has
 * this package, as a project that depends on rooklang has.
 */
export function moduleProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }');
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    new URL('..', import.meta.url).pathname,
    join(dir, 'node_modules', 'rooklang'),
    'dir',
  );

  return dir;
}
