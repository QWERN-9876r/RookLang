import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { moduleProject } from './project.ts';

// `for v in x` over an async iterable, such as a stream of Node: `for await` of JS. The types come
// from `[Symbol.asyncIterator]()` of a `.d.ts`, of an interface or of a class.

/** A module next to this file, so that `node:` modules have the types of @types/node. */
const file = join(import.meta.dirname, 'main.rk');

function errors(source: string): string[] {
  return compile(source, { filename: file }).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { filename: file });

  expect(diagnostics).toEqual([]);

  return code;
}

const READLINE = `import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
`;

describe('checking', () => {
  it('gives the values of the stream', () => {
    expect(
      errors(`${READLINE}
async func count(path string) number {
    let n = 0
    for line in createInterface({ input: createReadStream(path) }) {
        const length number = line.length
        const wrong number = line
        n++
    }
    return n
}
async func total(stream ReadableStream<string>) number {
    let n = 0
    for part in stream {
        n += part.length
    }
    return n
}`),
    ).toEqual(['cannot use string as number']);
  });

  it('waits, so only in async functions, and has no keys', () => {
    expect(
      errors(`${READLINE}
func count(path string) {
    for line in createInterface({ input: createReadStream(path) }) {
    }
}
async func numbered(path string) {
    for i, line in createInterface({ input: createReadStream(path) }) {
    }
}`),
    ).toEqual([
      '"for ... in" Interface waits for its values, so it is allowed only in async functions and at the top level of a module',
      'Interface has no keys: loop over its values, e.g. "for value in items"',
    ]);
  });
});

describe('the generated code', () => {
  it('is for await of JS, and an array stays a for...of', () => {
    const code = js(`${READLINE}
const lines = createInterface({ input: createReadStream("a.txt") })
for line in lines {
    console.log(line)
}
for n in [1, 2] {
    console.log(n)
}`);

    expect(code).toContain('for await (const line of lines) {');
    expect(code).toContain('for (const n of [1, 2]) {');
  });
});

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

describe('running', () => {
  it('waits for each value, and break closes the iterator', () => {
    const dir = moduleProject('rook-async-iterables-');
    const pkg = join(dir, 'node_modules', 'counter');

    mkdirSync(pkg);
    writeFileSync(
      join(pkg, 'package.json'),
      '{ "name": "counter", "type": "module", "main": "index.js", "types": "index.d.ts" }',
    );
    writeFileSync(
      join(pkg, 'index.d.ts'),
      `export declare class Counter {
  constructor(to: number);
  [Symbol.asyncIterator](): AsyncIterator<number>;
}
export interface Pages<T> { [Symbol.asyncIterator](): AsyncIterator<T[]> }
export declare function pages<T>(items: T[]): Pages<T>;
`,
    );
    writeFileSync(
      join(pkg, 'index.js'),
      `export class Counter {
  constructor(to) { this.to = to; }
  async *[Symbol.asyncIterator]() {
    try {
      for (let i = 1; i <= this.to; i++) yield await Promise.resolve(i);
    } finally {
      console.log("closed");
    }
  }
}
export function pages(items) {
  return { async *[Symbol.asyncIterator]() { yield items.slice(0, 2); yield items.slice(2); } };
}
`,
    );
    writeFileSync(
      join(dir, 'main.rk'),
      `import { Counter, pages } from "counter"

let sum = 0
for n in new Counter(10) {
    if n > 3 {
        break
    }
    sum += n
}
console.log("sum", sum)
for page in pages(["a", "b", "c"]) {
    console.log(page.join(""))
}
`,
    );

    const { stdout, stderr } = spawnSync(process.execPath, [cli, 'run', 'main.rk'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(stderr).toBe('');
    expect(stdout).toBe('closed\nsum 6\nab\nc\n');
  });
});
