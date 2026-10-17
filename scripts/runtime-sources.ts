import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';

// Writes src/runtime/sources.ts: the code of the files of src/runtime as text, which the compiler
// puts into a module with `runtime: 'inline'` (src/codegen/runtime.ts). The browser compiler cannot
// read files, so the text is a module of its own. `npm run format` runs this after formatting the
// files, and tests/runtime.test.ts checks that the text is that of the files.

const dir = new URL('../src/runtime/', import.meta.url);
const target = new URL('sources.ts', dir);

/** The text of each file but index.js, which only exports the others. */
export function runtimeFiles(): Record<string, string> {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.js') && name !== 'index.js')
    .sort();

  return Object.fromEntries(names.map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]));
}

if (import.meta.main) {
  const entries = Object.entries(runtimeFiles()).map(
    ([name, code]) => `  ${JSON.stringify(name)}: ${JSON.stringify(code)},`,
  );
  const text = [
    '// Written by scripts/runtime-sources.ts from the files of src/runtime: change them, not this,',
    '// and `npm run format` writes it again.',
    '',
    '/** The code of the runtime by file, for modules that have it in them (codegen/runtime.ts). */',
    'export const RUNTIME_FILES: Readonly<Record<string, string>> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
  const options = await prettier.resolveConfig(target.pathname);

  writeFileSync(target, await prettier.format(text, { ...options, filepath: target.pathname }));
}
