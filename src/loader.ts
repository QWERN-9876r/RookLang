import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import type * as Build from './build.ts';
import type * as CompileFile from './compile-file.ts';
import { RUNTIME_MODULE } from './runtime-module.ts';
import { sourceMapComment, type SourceMap } from './source-map.ts';

// `rook run` imports this module first (`node --import`): Node then imports `.rk` files,
// compiled when they load, and `app.rk?goroutines` is the worker module of `go` in app.rk.
// The worker threads of `go` import it too, since they get the `--import` of the process. The main
// thread compiles a module before any worker needs it, so it leaves the code of each module and
// of its worker module in ROOK_RUN_CACHE, a directory of the run, and the workers take it from
// there: compiling again, with the types, would take each of them as long. So a worker does not
// even load the compiler, which takes ~80 ms, unless a module is missing from the cache; the hooks
// are synchronous, so it is loaded with require(). ROOK_NO_CHECK turns type checking off, and
// ROOK_MARKUP, 1 or 0, markup and components on or off for every file. The code has its source map
// in it, and the process runs with --enable-source-maps, so stack traces show the lines of .rk.

const typeCheck = process.env['ROOK_NO_CHECK'] === undefined;
const markupSetting = process.env['ROOK_MARKUP'];
const markup = markupSetting === undefined ? undefined : markupSetting === '1';
const cache = process.env['ROOK_RUN_CACHE'];

/** The file of the cache for the code of a URL, query included. */
function cached(url: string): string | null {
  return cache ? join(cache, `${createHash('sha1').update(url).digest('hex')}.js`) : null;
}

// The compiled code imports the runtime of this compiler, wherever the program is.
const runtime = import.meta.resolve(RUNTIME_MODULE);
const require = createRequire(import.meta.url);
// The files next to this one: .ts in src, .js in the dist of the package.
const extension = extname(fileURLToPath(import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === RUNTIME_MODULE) return { url: runtime, shortCircuit: true };

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const { protocol, pathname, search } = new URL(url);

    if (protocol !== 'file:' || !pathname.endsWith('.rk')) return nextLoad(url, context);

    const file = cached(url);

    if (!isMainThread && file && existsSync(file)) {
      return { format: 'module', source: readFileSync(file, 'utf8'), shortCircuit: true };
    }

    const moduleUrl = new URL(pathname, url).href;
    const { displayPath } = require(`./build${extension}`) as typeof Build;
    const { compileFile } = require(`./compile-file${extension}`) as typeof CompileFile;
    const path = displayPath(fileURLToPath(moduleUrl));
    const result = compileFile(path, {
      rewriteImports: false,
      typeCheck,
      markup,
      quiet: !isMainThread,
    });

    const code = withMap(result.code, result.map);
    const worker =
      result.worker === undefined ? undefined : withMap(result.worker, result.workerMap);

    if (isMainThread && cache) {
      writeFileSync(cached(moduleUrl)!, code);
      if (worker !== undefined) writeFileSync(cached(`${moduleUrl}?goroutines`)!, worker);
    }

    const source = search === '?goroutines' ? (worker ?? '') : code;

    return { format: 'module', source, shortCircuit: true };
  },
});

/** The code with its source map in it. */
function withMap(code: string, map: SourceMap | undefined): string {
  if (map === undefined || code === '') return code;

  const data = Buffer.from(JSON.stringify(map)).toString('base64');

  return `${code}${sourceMapComment(`data:application/json;base64,${data}`)}`;
}
