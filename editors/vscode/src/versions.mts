import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pkg from '../../../package.json' with { type: 'json' };

// The version of the compiler that the extension carries, and the update of a project whose
// installed rooklang is older: that one checks its files, and newer syntax is an error there.

/** The version of the bundled compiler, which is that of the extension too. */
export const VERSION = pkg.version;

/** Whether version `a` is older than `b`, by the numbers of `major.minor.patch`. */
export function isOlder(a: string, b: string): boolean {
  const left = numbers(a);
  const right = numbers(b);

  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);

    if (difference !== 0) return difference < 0;
  }

  return false;
}

/** The numbers of a version; a pre-release (`0.5.0-beta.1`) counts as its release. */
function numbers(version: string): number[] {
  return (version.split('-')[0] ?? '').split('.').map((part) => Number(part) || 0);
}

/** The lock files of the package managers: the first one found names the one a project uses. */
const MANAGERS: [lock: string, command: string][] = [
  ['bun.lock', 'bun add'],
  ['bun.lockb', 'bun add'],
  ['pnpm-lock.yaml', 'pnpm add'],
  ['yarn.lock', 'yarn add'],
];

/**
 * The project of an installed rooklang, the folder of its `node_modules`, and the command that
 * installs a version there with the package manager of its lock file, npm without one.
 */
export function updateCommand(
  installed: string,
  version: string,
  exists: (path: string) => boolean = existsSync,
): { folder: string; command: string } {
  const folder = dirname(dirname(installed));
  const manager = MANAGERS.find(([lock]) => exists(join(folder, lock)));

  return { folder, command: `${manager?.[1] ?? 'npm install'} rooklang@${version}` };
}
