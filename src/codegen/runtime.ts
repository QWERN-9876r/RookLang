import { RUNTIME_MODULE } from '../runtime-module.ts';
import { RUNTIME_FILES } from '../runtime/sources.ts';

// The runtime of generated code, src/runtime. A module imports the names of it that its code uses
// from "rooklang/runtime"; with `runtime: 'inline'` the files that have them are put into the
// module instead, for code that runs without imports, such as that of the playground. A module
// keeps what is its own: the start of its workers, whose URL a bundler must see in it, the `go`
// that uses it, and the CSS of its components.

/** How a module gets the runtime: by an import, or with the code of the runtime in it. */
export type RuntimeMode = 'import' | 'inline';

/**
 * Predeclared names of goroutines and channels, and what they are in JS: `close(ch)` is
 * `$$Channel.close(ch)`, and `Channel` itself is `$$Channel`, so that the names of a program stay
 * its own.
 */
export const PREDECLARED: ReadonlyMap<string, string> = new Map([
  ['abortSignal', '$$Channel.abortSignal'],
  ['after', '$$Channel.after'],
  ['cancel', '$$cancel'],
  ['Channel', '$$Channel'],
  ['close', '$$Channel.close'],
  ['done', '$$Channel.done'],
  ['signal', '$$Channel.signal'],
  ['stream', '$$Channel.stream'],
  ['tick', '$$Channel.tick'],
  ['Topic', '$$Topic'],
  ['transfer', '$$transfer'],
]);

interface RuntimeFile {
  /** The code without its imports and the `export` of its declarations. */
  code: string;
  /** The files whose names it uses. */
  needs: string[];
}

/** A name of generated code, but not a member: `$$chan(...)`, and not `channel.$$chan`. */
const NAME = /(?<![.\w$])\$\$[A-Za-z_][\w$]*/g;

const files = new Map<string, RuntimeFile>();
const owners = new Map<string, string>();

for (const [file, source] of Object.entries(RUNTIME_FILES)) {
  const needs = [...source.matchAll(/^import [^;]* from '\.\/(\w+\.js)';$/gm)].map(
    (match) => match[1]!,
  );

  for (const match of source.matchAll(
    /^export (?:async )?(?:function\*?|class|const|let) (\$\$\w+)/gm,
  )) {
    owners.set(match[1]!, file);
  }

  const code = source
    .replace(/^import [^;]*;\n+/gm, '')
    .replace(/^export /gm, '')
    .trimEnd();

  files.set(file, { code, needs });
}

/** The names of the runtime that code uses, in order. */
export function runtimeNames(code: string): string[] {
  return [...new Set(code.match(NAME))].filter((name) => owners.has(name)).sort();
}

/** What gives a module these names of the runtime: an import, or the files that have them. */
export function runtimeCode(names: readonly string[], mode: RuntimeMode): string[] {
  if (names.length === 0) return [];

  if (mode === 'import') {
    const line = `import { ${names.join(', ')} } from "${RUNTIME_MODULE}";`;

    return line.length <= 100
      ? [line]
      : ['import {', ...names.map((name) => `  ${name},`), `} from "${RUNTIME_MODULE}";`];
  }

  const needed = new Set<string>();
  const add = (file: string) => {
    if (needed.has(file)) return;
    needed.add(file);
    for (const other of files.get(file)!.needs) add(other);
  };

  for (const name of names) add(owners.get(name)!);

  // The files only declare, but for a few that register what a thread shares, so their order does
  // not matter: the one of RUNTIME_FILES.
  const code = [...files]
    .filter(([file]) => needed.has(file))
    .flatMap(([, { code }], i) => [...(i > 0 ? [''] : []), ...code.split('\n')]);
  const list = names.join(', ');

  // A function of its own keeps the names of the runtime that are not `$$`, such as check() of
  // decode, apart from those of the program, which may declare a check() too: only the names that
  // the code uses come out of it.
  return [`const { ${list} } = (() => {`, ...code, '', `return { ${list} };`, '})();'];
}

/**
 * The `go` of a module: in a module, a call in a worker that starts with its worker module; in the
 * worker module, a call in the same worker, of a function of `$$goroutines`.
 */
export function moduleGo(workerUrl: string | null, nodeLoader?: string): string[] {
  if (workerUrl === null) {
    return ['const $$go = (fn, args) => $$goHere($$goroutines, fn, args);'];
  }

  return [
    ...startWorker(workerUrl, nodeLoader),
    '',
    'const $$go = (name, args) => $$goWorker($$startWorker, name, args);',
  ];
}

/**
 * The start of a worker of a module: a Web Worker, or a worker thread of Node. Node takes only the
 * path of a `file:` URL, without the query of `app.rk?goroutines`, so its worker starts with a
 * module that imports the whole URL. An absolute URL, such as the Blob of the playground, is used
 * as it is. With `nodeLoader`, as under Vitest, the worker of Node imports the loader of `.rk`
 * files first, since its thread has neither Vite nor the loader of `rook run`.
 */
function startWorker(url: string, nodeLoader?: string): string[] {
  // The loader registers its hooks when it runs, so the module comes after it, by a dynamic import.
  const code =
    nodeLoader === undefined
      ? '`import ${JSON.stringify(url.href)};`'
      : `\`import ${JSON.stringify(nodeLoader)}; await import(\${JSON.stringify(url.href)});\``;

  const base = /^[a-z][a-z\d+.-]*:/i.test(url) ? '' : ', import.meta.url';
  const workerUrl = `new URL(${JSON.stringify(url)}${base})`;

  return [
    'async function $$startWorker() {',
    '  if (typeof Worker === "function") {',
    `    return new Worker(${workerUrl}, { type: "module" });`,
    '  }',
    '  const threads = "node:worker_threads";',
    '  const { Worker: NodeWorker } = await import(/* @vite-ignore */ threads);',
    // Vite bundles the Web Worker; this URL is only for Node.
    `  const url = new URL(/* @vite-ignore */ ${JSON.stringify(url)}${base});`,
    `  const code = ${code};`,
    '  return new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));',
    '}',
  ];
}
