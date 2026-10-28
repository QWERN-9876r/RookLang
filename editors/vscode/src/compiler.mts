import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as bundled from '../../../src/index.ts';

// Which compiler checks a file: the one installed next to it, `node_modules/rooklang` of the nearest
// folder up from the file, as Node would find it, so the editor gives the errors of the version
// that `rook build` runs; else the copy that the extension carries. Loading the installed one runs
// code of the project, so it is used only in a trusted workspace. A version without `complete` or
// `importFixes` gets them from the copy of the extension.

/** What the language server calls. */
export interface Compiler {
  compile: typeof bundled.compile;
  complete: typeof bundled.complete;
  importFixes: typeof bundled.importFixes;
  /** The installed package, or null for the copy of the extension. */
  installed: { version: string; path: string } | null;
}

export const BUNDLED: Compiler = {
  compile: bundled.compile,
  complete: bundled.complete,
  importFixes: bundled.importFixes,
  installed: null,
};

/** The folder of `node_modules/rooklang` nearest to the file, if there is one. */
export function findInstalled(filename: string): string | undefined {
  let dir = dirname(resolve(filename));

  while (true) {
    const candidate = join(dir, 'node_modules', 'rooklang');

    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(dir);

    if (parent === dir) return undefined;
    dir = parent;
  }
}

interface PackageJson {
  version?: string;
  main?: string;
  exports?: string | Record<string, unknown>;
}

/** The module that `import "rooklang"` loads, from the `exports` of the package or its `main`. */
function entryOf(pkg: PackageJson): string | undefined {
  const root = typeof pkg.exports === 'object' ? pkg.exports['.'] : pkg.exports;

  if (typeof root === 'string') return root;
  if (root && typeof root === 'object') {
    const conditions = root as Record<string, unknown>;
    const entry = conditions.import ?? conditions.default;

    if (typeof entry === 'string') return entry;
  }

  return pkg.main;
}

/**
 * Loaded compilers by the address of their module and the time of their package.json: a new
 * version installed in the same folder is loaded again, as a new module.
 */
const loaded = new Map<string, Promise<Compiler>>();

/** The compiler of a file; `log` hears which one, once per version, and why one could not load. */
export function compilerFor(
  filename: string | undefined,
  trusted: boolean,
  log: (message: string) => void = () => {},
): Promise<Compiler> {
  const path = filename && trusted ? findInstalled(filename) : undefined;

  if (!path) return Promise.resolve(BUNDLED);

  const packageJson = join(path, 'package.json');
  let pkg: PackageJson;

  try {
    pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as PackageJson;
  } catch (error) {
    log(`cannot read ${packageJson}: ${String(error)}; using the compiler of the extension`);

    return Promise.resolve(BUNDLED);
  }

  const entry = entryOf(pkg);

  if (!entry) {
    log(`${packageJson} names no module to load; using the compiler of the extension`);

    return Promise.resolve(BUNDLED);
  }

  const url = `${pathToFileURL(join(path, entry)).href}?${statSync(packageJson).mtimeMs}`;
  let compiler = loaded.get(url);

  if (!compiler) {
    compiler = load(url, { version: pkg.version ?? 'unknown', path }, log);
    loaded.set(url, compiler);
  }

  return compiler;
}

async function load(
  url: string,
  installed: { version: string; path: string },
  log: (message: string) => void,
): Promise<Compiler> {
  try {
    const module = (await import(url)) as Partial<Compiler>;

    if (typeof module.compile !== 'function') {
      log(`${installed.path} has no compile(); using the compiler of the extension`);

      return BUNDLED;
    }

    log(`using rooklang ${installed.version} of ${installed.path}`);

    return {
      compile: module.compile,
      complete: typeof module.complete === 'function' ? module.complete : bundled.complete,
      importFixes:
        typeof module.importFixes === 'function' ? module.importFixes : bundled.importFixes,
      installed,
    };
  } catch (error) {
    log(`cannot load ${installed.path}: ${String(error)}; using the compiler of the extension`);

    return BUNDLED;
  }
}
