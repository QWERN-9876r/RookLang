import { readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { RUNTIME_MODULE } from './runtime-module.ts';
import { formatDiagnostic } from './diagnostics.ts';
import { compile } from './index.ts';
import { SourceFile } from './source.ts';

// A Vite plugin for Rook: `.rk` modules are compiled when Vite loads them, with type
// checking, so `import { App } from "./app.rk"` works in a Vite project. Type errors stop the
// build and show up in the browser overlay of the dev server. `app.rk.goroutines.js` is the
// worker module of `go` in app.rk, which Vite bundles as a worker: it is not a file, and its
// path has no query, since Vite drops the query of a worker's URL. The compiled code imports the
// runtime, "rooklang/runtime", of the plugin's own package.

const GOROUTINES = '.goroutines.js';

/** The loader of `.rk` files of `rook run`, next to this file: .ts in src, .js in the package. */
const LOADER = new URL(`./loader${extname(fileURLToPath(import.meta.url))}`, import.meta.url).href;

export interface RookPluginOptions {
  /** Check types before generating code. Defaults to `true`. */
  typeCheck?: boolean;
  /**
   * Markup and components, for every `.rk` file; by default as the package.json of the file
   * says, `"rook": { "markup": true }`.
   */
  markup?: boolean;
}

export function rook(options: RookPluginOptions = {}): Plugin {
  const typeCheck = options.typeCheck ?? true;
  let root = process.cwd();

  return {
    name: 'rooklang',
    // Vite bundles workers with plugins of their own: the worker modules of `go` need this one too,
    // and they are ES modules.
    config(config) {
      const plugins = config.worker?.plugins;

      return {
        worker: { format: 'es', plugins: () => [...(plugins?.() ?? []), rook(options)] },
      };
    },
    configResolved(config) {
      root = config.root;
    },
    resolveId(source, importer) {
      // The runtime of the compiled code is the one of this compiler, whichever the project has.
      if (source === RUNTIME_MODULE) return fileURLToPath(import.meta.resolve(RUNTIME_MODULE));

      const [path = source] = source.split('?');

      if (!path.endsWith(`.rk${GOROUTINES}`)) return null;
      if (!isAbsolute(path)) return resolve(dirname(importer ?? join(root, 'index.html')), path);

      // `/app.rk.goroutines.js` from the dev server is a path in the root.
      return path.startsWith(root) ? path : join(root, path);
    },
    load(id) {
      const [path = id] = id.split('?');

      if (!path.endsWith(`.rk${GOROUTINES}`)) return null;

      return readFileSync(path.slice(0, -GOROUTINES.length), 'utf8');
    },
    transform(source, id, transformOptions) {
      const [name = id, query] = id.split('?');
      const worker = name.endsWith(`.rk${GOROUTINES}`);
      const path = worker ? name.slice(0, -GOROUTINES.length) : name;

      // `app.rk?raw` and the like are left to Vite; it adds queries of its own to workers.
      if (!path.endsWith('.rk') || (query !== undefined && !worker)) return null;

      // Imports keep `.rk`: Vite resolves them and gives them to this plugin again.
      const result = compile(source, {
        filename: path,
        rewriteImports: false,
        typeCheck,
        markup: options.markup,
        // In Node, as under Vitest, a worker thread loads the module itself, `app.rk?goroutines`,
        // with the loader of `rook run`, which it imports first: it has no Vite.
        ...(transformOptions?.ssr === true
          ? { workerUrl: `./${basename(path)}?goroutines`, nodeLoader: LOADER }
          : { workerUrl: `./${basename(path)}${GOROUTINES}` }),
      });
      const file = new SourceFile(relative(root, path), source);
      // Vite counts columns from 0.
      const loc = (start: number) => {
        const { line, column } = file.position(start);

        return { line, column: column - 1 };
      };

      for (const warning of result.warnings) {
        this.warn({
          message: formatDiagnostic(file, warning, 'warning'),
          id,
          loc: loc(warning.start),
        });
      }

      if (result.diagnostics.length > 0) {
        this.error({
          message: result.diagnostics.map((d) => formatDiagnostic(file, d)).join('\n\n'),
          id,
          loc: loc(result.diagnostics[0]!.start),
        });
      }

      // The code of imported decorators is inlined here, and their types are used: when an
      // imported module changes, this one is compiled again.
      for (const dependency of result.dependencies) {
        this.addWatchFile(resolve(dirname(path), dependency));
      }

      return worker
        ? { code: result.worker ?? '', map: result.workerMap ?? null }
        : { code: result.code, map: result.map ?? null };
    },
  };
}
