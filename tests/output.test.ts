import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// What the compiler writes for the examples of the site and of examples/, kept in
// tests/output/<name>.js.snap: a change of the generated code shows in the diff of its commit, and
// one that nobody meant fails here. After a change made on purpose, `npx vitest run -u
// tests/output.test.ts` writes the files again. They are not .js, so that Prettier, ESLint and
// the limit of 400 lines leave the generated code as it is.

const FOLDERS = [
  { folder: '../site/examples/', prefix: '' },
  { folder: '../examples/', prefix: 'examples-' },
];

const examples = FOLDERS.flatMap(({ folder, prefix }) => {
  const url = new URL(folder, import.meta.url);

  return readdirSync(url)
    .filter((file) => file.endsWith('.rk'))
    .map((file) => ({ name: prefix + file.slice(0, -3), source: new URL(file, url) }));
});

/** The module, its worker module if it has `go`, and its declarations, one after another. */
function output(name: string, source: string): string {
  const { code, worker, declarations, diagnostics } = compile(source, {
    markup: true,
    declarations: true,
    workerUrl: `./${name}.worker.js`,
  });

  expect(diagnostics).toEqual([]);

  return [
    `// ${name}.js\n\n${code}`,
    ...(worker ? [`// ${name}.worker.js\n\n${worker}`] : []),
    ...(declarations ? [`// ${name}.d.ts\n\n${declarations}`] : []),
  ].join('\n');
}

describe('the output of the examples', () => {
  it.each(examples)('is that of $name', async ({ name, source }) => {
    await expect(output(name, readFileSync(source, 'utf8'))).toMatchFileSnapshot(
      `output/${name}.js.snap`,
    );
  });

  it('keeps no file of an example that is gone', () => {
    expect(readdirSync(new URL('output/', import.meta.url)).sort()).toEqual(
      examples.map(({ name }) => `${name}.js.snap`).sort(),
    );
  });
});
