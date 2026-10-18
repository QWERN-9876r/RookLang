import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// `for i, v in items` over an array or a typed array loops over the indexes, and over a string by
// the numbers of its characters.

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics.map((d) => d.message)).toEqual([]);

  return code;
}

function run(source: string): string[] {
  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  const prototype = Object.getPrototypeOf(() => {}) as { constructor: unknown };
  const Program = prototype.constructor as new (...args: string[]) => (console: unknown) => void;

  new Program('console', js(source))({ log });

  return output;
}

describe('loops over the indexes', () => {
  it('compiles a loop over an array or a typed array to one over its indexes', () => {
    expect(js(`const xs = [10, 20]\nfor i, x in xs {\n    console.log(i, x)\n}`)).toContain(
      `for (let i = 0; i < xs.length; i++) {
  const x = xs[i];
  console.log(i, x);
}`,
    );
    expect(js(`const data = make([]uint8, 4)\nfor i, _ in data {\n    data[i] = 1\n}`)).toContain(
      `for (let i = 0; i < data.length; i++) {
  data[i] = 1;
}`,
    );
  });

  it('reads the array once unless it is a constant', () => {
    expect(js(`let xs = [1]\nfor i, x in xs {\n    console.log(i, x)\n}`)).toContain(
      'for (let i = 0, $$items = xs; i < $$items.length; i++) {\n  const x = $$items[i];',
    );
    expect(
      js(`func items() []number { return [1] }\nfor i, x in items() {\n    console.log(i, x)\n}`),
    ).toContain('for (let i = 0, $$items = items(); i < $$items.length; i++) {');
  });

  it('goes over the values without the index', () => {
    expect(js(`const xs = [1]\nfor _, x in xs {\n    console.log(x)\n}`)).toContain(
      'for (const x of xs) {',
    );
  });

  it('keeps maps and other iterables on entries()', () => {
    expect(
      js(`const m Map<string, number> = new Map()\nfor k, v in m {\n    console.log(k, v)\n}`),
    ).toContain('for (const [k, v] of m.entries()) {');
  });

  it('runs as the loop over the pairs did', () => {
    expect(
      run(`let xs = [10, 20, 30]
const fs []func() number = []
for i, x in xs {
    if i == 1 {
        continue
    }
    fs.push(() => i)
    xs = [0]
    console.log(i, x)
}
for i, x in [1, 2] {
    const x = i * 10
    console.log(x)
}
console.log(fs.map(f => f()))`),
    ).toEqual(['0 10', '2 30', '0', '10', '0,2']);
  });
});

describe('loops over a string', () => {
  it('numbers its characters, as for...of gives them', () => {
    const source = `const s = "a😀b"
for i, c in s {
    console.log(i, c)
}
for _, c in s {
    console.log(c)
}`;

    expect(js(source)).toContain('for (const [i, c] of Array.from(s).entries()) {');
    expect(js(source)).toContain('for (const c of s) {');
    expect(run(source)).toEqual(['0 a', '1 😀', '2 b', 'a', '😀', 'b']);
  });
});
