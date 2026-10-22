import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as syntaxErrors, expr, first, sx } from './parser-helpers.ts';

// `try expr`: an exception in the expression, or a rejected Promise that an `await` in it waits
// for, becomes the error of `(T, error)` (codegen/try.ts, runtime/try.js).

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  return code;
}

/** Runs a program in the main thread; returns what it printed. */
async function run(source: string): Promise<string[]> {
  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  const prototype = Object.getPrototypeOf(async () => {}) as { constructor: unknown };
  const AsyncFunction = prototype.constructor as new (
    ...args: string[]
  ) => (console: unknown) => Promise<void>;

  await new AsyncFunction('console', js(source))({ log });

  return output;
}

describe('parsing', () => {
  it('reads try before an expression, and try { } as a statement', () => {
    expect(sx(expr('try JSON.parse(text)'))).toBe('(try (call (. JSON parse) text))');
    expect(sx(expr('try a + b'))).toBe('(try (+ a b))');
    expect(sx(expr('try await fetch(url)'))).toBe('(try (await (call fetch url)))');
    expect(first('try {\n    f()\n} catch e {\n}', 'TryStatement').kind).toBe('TryStatement');
    expect(syntaxErrors('const data, err = try JSON.parse(text)')).toEqual([]);
    expect(syntaxErrors('func f() {\n    data, err = try JSON.parse(text)\n}')).toEqual([]);
  });

  it('does not drop the error of try', () => {
    expect(syntaxErrors('try save()')).toEqual([
      'try gives the error, which is dropped here: keep it, e.g. "const err = try save()", or catch it with try { } catch e { }',
    ]);
  });
});

describe('checking', () => {
  it('gives the value with an error, or the error alone', () => {
    expect(
      errors(`func save() {
}
func validate() error {
    return null
}
func load() (number, error) {
    return 1, null
}
func pair() (string, number) {
    return "a", 1
}
const data, e1 = try JSON.parse("1")
const e2 error = try save()
const e3 error = try validate()
const n, e4 = try load()
const s, m, e5 = try pair()
const sum number = n + 1`),
    ).toEqual(['cannot add ?number and number: a value may be null, check it first']);
    expect(errors('const data = try JSON.parse("1")')).toEqual([
      'try returns 2 values: unpack them, e.g. "const a, b = ..."',
    ]);
  });

  it('passes the values on from return', () => {
    expect(errors('func parse(s string) (any, error) {\n    return try JSON.parse(s)\n}')).toEqual(
      [],
    );
  });

  it('waits only in an async function', () => {
    expect(errors('func f() {\n    const r, err = try await fetch("/")\n}')).toEqual([
      '"await" is allowed only in async functions and at the top level of a module; mark the function, e.g. "async func load() { ... }"',
    ]);
  });

  it('cannot yield, since it compiles to a function', () => {
    expect(
      errors(`func count(yield func(number) bool) {
    const ok, err = try yield(1)
}`),
    ).toEqual([
      'yield cannot be in try, which compiles to a function: a JS generator yields only in its own body, so call yield outside of it',
    ]);
  });
});

describe('the generated code', () => {
  it('runs the expression in a function, and tells the runtime what it gives', () => {
    const code = js(`func save() {
}
func load() (number, error) {
    return 1, null
}
async func f(ch chan number) {
    const data, e1 = try JSON.parse("1")
    const e2 = try save()
    const n, e3 = try load()
    const point, e4 = try { x: JSON.parse("1") }
    const r, e5 = try await fetch("/")
    const v, e6 = try <-ch
}`);

    expect(code).toContain('const [data, e1] = $$catch(() => JSON.parse("1"));');
    expect(code).toContain('const e2 = $$catch(() => save(), 0);');
    expect(code).toContain('const [n, e3] = $$catch(() => load(), 2, true);');
    expect(code).toContain('const [point, e4] = $$catch(() => ({ x: JSON.parse("1") }));');
    expect(code).toContain('const [r, e5] = await $$catchAsync(async () => await fetch("/"));');
    expect(code).toContain(
      'const [v, e6] = await $$catchAsync(async () => await $$Channel.receive(ch, false, 0));',
    );
  });
});

describe('running', () => {
  it('turns an exception into the error', async () => {
    expect(
      await run(`func load(id number) (string, error) {
    if id < 0 {
        return "", error("negative")
    }
    if id == 0 {
        throw error("zero")
    }
    return \`user \${id}\`, null
}

func check(s string) {
    if s == "" {
        throw "empty"
    }
}

const data, err = try JSON.parse("[1]")
console.log(data, err)
const bad, badErr = try JSON.parse("{")
console.log(bad, badErr != null)
for id in [1, -1, 0] {
    const user, e = try load(id)
    console.log(user, e?.message)
}
for s in ["ok", ""] {
    const e = try check(s)
    console.log(e, e instanceof Error)
}`),
    ).toEqual([
      '1 null',
      'null true',
      'user 1 undefined',
      ' negative',
      'null zero',
      'null false',
      'Error: empty true',
    ]);
  });

  it('catches a rejected Promise that it waits for', async () => {
    expect(
      await run(`async func fail(message string) number {
    throw error(message)
}

const n, err = try await fail("no")
console.log(n, err?.message)
const m, ok = try await Promise.resolve(2)
console.log(m, ok)`),
    ).toEqual(['null no', '2 null']);
  });
});
