import { createHash } from 'node:crypto';
import { appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sourceMapComment, type SourceMap } from './source-map.ts';

// The directory of a run of a program, ROOK_RUN_CACHE: the compiled code of its modules, which the
// worker threads of `go` take instead of compiling them again, and `files`, the list of the files
// that the run compiled or read, which `rook run --watch` watches (run-file.ts). The loader of
// Node (loader.ts) and the plugin of Bun (bun.ts) keep it; neither loads the compiler for it.

/** The file of the cache for the code of a URL, query included. */
export function cachedFile(cache: string, url: string): string {
  return join(cache, `${createHash('sha1').update(url).digest('hex')}.js`);
}

/** The code with its source map in it. */
export function withMap(code: string, map: SourceMap | undefined): string {
  if (map === undefined || code === '') return code;

  const data = Buffer.from(JSON.stringify(map)).toString('base64');

  return `${code}${sourceMapComment(`data:application/json;base64,${data}`)}`;
}

/** Adds files to the list of the run: a line of the path and the time it was changed. */
export function listFiles(cache: string, paths: readonly string[]): void {
  const lines = paths.map((path) => `${path}\t${statSync(path).mtimeMs}\n`);

  appendFileSync(join(cache, 'files'), lines.join(''));
}
