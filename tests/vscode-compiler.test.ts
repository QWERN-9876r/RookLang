import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import extension from '../editors/vscode/package.json' with { type: 'json' };
import { BUNDLED, compilerFor, findInstalled } from '../editors/vscode/src/compiler.mts';
import { isOlder, updateCommand, VERSION } from '../editors/vscode/src/versions.mts';
import pkg from '../package.json' with { type: 'json' };
import { complete } from '../src/index.ts';

// The compiler that the language server of the VS Code extension checks a file with: rooklang
// installed next to it, in a trusted workspace, else the copy of the extension.

/** A project with a package rooklang in node_modules whose module is `index`. */
function project(version: string, index: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'rook-compiler-'));

  install(root, version, index);
  mkdirSync(join(root, 'src'));

  return { root, file: join(root, 'src', 'app.rk') };
}

function install(root: string, version: string, index: string, time = Date.now() / 1000): void {
  const dir = join(root, 'node_modules', 'rooklang');
  const packageJson = join(dir, 'package.json');

  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.js'), index);
  writeFileSync(
    packageJson,
    JSON.stringify({
      name: 'rooklang',
      version,
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }),
  );
  utimesSync(packageJson, time, time);
}

/** A module whose compile() gives `code` as its code. */
const compileGiving = (code: string) =>
  `export function compile() { return { code: ${JSON.stringify(code)}, diagnostics: [], warnings: [], dependencies: [] }; }\n`;

describe('the compiler of a file', () => {
  it('is the rooklang installed nearest to the file, in a trusted workspace', async () => {
    const { root, file } = project('9.9.9', compileGiving('installed'));
    const compiler = await compilerFor(file, true);

    expect(findInstalled(file)).toBe(join(root, 'node_modules', 'rooklang'));
    expect(compiler.installed).toEqual({
      version: '9.9.9',
      path: join(root, 'node_modules', 'rooklang'),
    });
    expect(compiler.compile('').code).toBe('installed');
    // A version without complete() gets the one of the extension.
    expect(compiler.complete).toBe(complete);
  });

  it('is the copy of the extension in an untrusted workspace, or without rooklang installed', async () => {
    const { file } = project('9.9.9', compileGiving('installed'));
    const elsewhere = join(mkdtempSync(join(tmpdir(), 'rook-compiler-')), 'app.rk');

    expect(await compilerFor(file, false)).toBe(BUNDLED);
    expect(await compilerFor(elsewhere, true)).toBe(BUNDLED);
    expect(await compilerFor(undefined, true)).toBe(BUNDLED);
  });

  it('loads a new version installed in the same folder', async () => {
    const { root, file } = project('1.0.0', compileGiving('old'));

    expect((await compilerFor(file, true)).compile('').code).toBe('old');

    install(root, '1.0.1', compileGiving('new'), Date.now() / 1000 + 60);

    const compiler = await compilerFor(file, true);

    expect(compiler.installed?.version).toBe('1.0.1');
    expect(compiler.compile('').code).toBe('new');
  });

  it('is the copy of the extension when the installed one cannot load, and says why', async () => {
    const broken = project('2.0.0', 'export function compile( {\n');
    const empty = project('2.0.1', 'export const version = 1;\n');
    const messages: string[] = [];
    const log = (message: string) => messages.push(message);

    expect(await compilerFor(broken.file, true, log)).toBe(BUNDLED);
    expect(await compilerFor(empty.file, true, log)).toBe(BUNDLED);
    expect(messages).toEqual([
      expect.stringMatching(
        /^cannot load .*node_modules\/rooklang: .+; using the compiler of the extension$/,
      ),
      expect.stringMatching(/rooklang has no compile\(\); using the compiler of the extension$/),
    ]);
  });
});

describe('the version of the extension', () => {
  // A new version of the package is a new version of the extension too: the stores give users
  // a new copy of the compiler only for a new version (.github/workflows/vscode.yml).
  it('is the version of the compiler it carries', () => {
    expect(extension.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it('is compared with the installed one by its numbers', () => {
    expect(isOlder('0.3.4', '0.4.0')).toBe(true);
    expect(isOlder('0.4.0', '0.4.0')).toBe(false);
    expect(isOlder('0.10.0', '0.9.1')).toBe(false);
    expect(isOlder('1.0.0', '0.9.9')).toBe(false);
    expect(isOlder('0.4.0-beta.1', '0.4.0')).toBe(false);
  });

  it('is installed in the project with the package manager of its lock file', () => {
    const installed = join('/work', 'app', 'node_modules', 'rooklang');
    const locks = (lock?: string) => (path: string) => path === join('/work', 'app', lock ?? '');

    expect(updateCommand(installed, '0.4.0', locks())).toEqual({
      folder: join('/work', 'app'),
      command: 'npm install rooklang@0.4.0',
    });
    expect(updateCommand(installed, '0.4.0', locks('bun.lock')).command).toBe(
      'bun add rooklang@0.4.0',
    );
    expect(updateCommand(installed, '0.4.0', locks('pnpm-lock.yaml')).command).toBe(
      'pnpm add rooklang@0.4.0',
    );
    expect(updateCommand(installed, '0.4.0', locks('yarn.lock')).command).toBe(
      'yarn add rooklang@0.4.0',
    );
  });
});
