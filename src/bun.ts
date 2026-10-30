import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { displayPath } from './build.ts';
import type { CompileResult } from './compile.ts';
import { compileFile } from './compile-file.ts';
import { cachedFile, listFiles, withMap } from './run-cache.ts';
import { RUNTIME_MODULE } from './runtime-module.ts';

// The plugin of Bun: `bun app.rk`, `import "./cart.rk"` from TypeScript and `bun test` compile the
// `.rk` modules when they load, as `rook run` does in Node (loader.ts). `preload =
// ["rooklang/bun/register"]` in bunfig.toml registers it (bun-register.ts), and so does
// `rook run` under Bun.
//
// `app.rk.goroutines.js` is the worker module of `go` in app.rk: Bun drops the query of
// `app.rk?goroutines` before a plugin sees it, as Vite does (vite.ts). A Web Worker of Bun has no
// preload and loads its module without the plugins, so it starts with a module that registers the
// plugin first (startWorker in codegen/runtime.ts). The main thread compiles a module once and
// leaves its code and that of its worker module in ROOK_RUN_CACHE, a directory of the run, which
// the workers take instead of compiling again; without a run of `rook run`, the plugin makes one
// and removes it when the process ends.

/** The worker module of `go` in a module, `app.rk.goroutines.js`, next to it. */
const GOROUTINES = '.goroutines.js';

/** What a plugin of Bun is given, of what Rook uses: the package needs no types of Bun. */
interface PluginBuilder {
  onResolve(
    constraints: { filter: RegExp; namespace?: string },
    callback: (args: { path: string; importer: string }) => { path: string; namespace?: string },
  ): void;
  onLoad(
    constraints: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => { contents: string; loader: 'js' },
  ): void;
}

export interface BunPlugin {
  name: string;
  setup(build: PluginBuilder): void;
}

export interface RookBunOptions {
  /** Check types before generating code. Defaults to `true`. */
  typeCheck?: boolean;
  /** Markup and components; by default as the package.json of the file says. */
  markup?: boolean;
}

// The files next to this one: .ts in src, .js in the dist of the package.
const extension = extname(fileURLToPath(import.meta.url));
// The worker of `go` registers the plugin with this module before it imports its module.
const register = new URL(`./bun-register${extension}`, import.meta.url).href;
// The compiled code imports the runtime of this compiler, wherever the program is, by its URL: a
// worker of Bun does not give a plugin the bare `rooklang/runtime`, and looks for the package.
const runtimeImport = `from "${RUNTIME_MODULE}";`;
const runtime = `from ${JSON.stringify(import.meta.resolve(RUNTIME_MODULE))};`;

export function rook(options: RookBunOptions = {}): BunPlugin {
  return {
    name: 'rook',
    setup(build) {
      build.onResolve({ filter: /\.rk\.goroutines\.js$/ }, (args) => ({
        path: args.path.startsWith('file:')
          ? fileURLToPath(args.path)
          : resolve(dirname(args.importer), args.path),
        namespace: 'rook-goroutines',
      }));
      build.onLoad({ filter: /.*/, namespace: 'rook-goroutines' }, (args) => ({
        contents: load(args.path.slice(0, -GOROUTINES.length), true, options),
        loader: 'js',
      }));
      build.onLoad({ filter: /\.rk$/ }, (args) => ({
        contents: load(args.path, false, options),
        loader: 'js',
      }));
    },
  };
}

/**
 * The code of a module or of its worker module, from the cache of the run when it is there. The
 * key has the time the file was changed, since `bun --hot` loads a changed module again.
 */
function load(path: string, worker: boolean, options: RookBunOptions): string {
  const url = `${pathToFileURL(path).href}#${statSync(path).mtimeMs}`;
  const cache = runCache();
  const file = cachedFile(cache, worker ? `${url}${GOROUTINES}` : url);

  if (existsSync(file)) return readFileSync(file, 'utf8');

  const result = compile(path, options);
  const code = withMap(result.code.replaceAll(runtimeImport, runtime), result.map);
  const workerCode = withMap(
    (result.worker ?? '').replaceAll(runtimeImport, runtime),
    result.workerMap,
  );

  if (isMainThread) {
    // The CSS modules it imports; the .rk modules are listed when they are loaded.
    const read = result.dependencies.map((each) => resolve(dirname(path), each));

    listFiles(cache, [path, ...read.filter((each) => existsSync(each))]);
    writeFileSync(cachedFile(cache, url), code);
    writeFileSync(cachedFile(cache, `${url}${GOROUTINES}`), workerCode);
  }

  return worker ? workerCode : code;
}

function compile(path: string, options: RookBunOptions): CompileResult {
  return compileFile(displayPath(path), {
    rewriteImports: false,
    typeCheck: options.typeCheck ?? process.env['ROOK_NO_CHECK'] === undefined,
    markup: options.markup ?? markupSetting(),
    quiet: !isMainThread,
    workerUrl: `./${basename(path)}${GOROUTINES}`,
    nodeLoader: register,
  });
}

/** ROOK_MARKUP of `rook run`, 1 or 0, turns markup on or off for every file. */
function markupSetting(): boolean | undefined {
  const setting = process.env['ROOK_MARKUP'];

  return setting === undefined ? undefined : setting === '1';
}

/** The directory of the run: that of `rook run`, or one of this process, which its workers share. */
function runCache(): string {
  const existing = process.env['ROOK_RUN_CACHE'];

  if (existing !== undefined) return existing;

  const dir = mkdtempSync(join(tmpdir(), 'rook-bun-'));

  process.env['ROOK_RUN_CACHE'] = dir;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

  return dir;
}
