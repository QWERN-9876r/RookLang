import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// `error("load user", err)`: an error whose message ends with that of its cause, as `%w` of Go,
// and whose `cause` is that error (runtime/core.js).

function compiled(source: string): { code: string; errors: string[] } {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  return { code, errors: diagnostics.map((d) => d.message) };
}

/** Runs a program in the main thread; returns what it printed. */
async function run(source: string): Promise<string[]> {
  const { code, errors } = compiled(source);
  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  const prototype = Object.getPrototypeOf(async () => {}) as { constructor: unknown };
  const AsyncFunction = prototype.constructor as new (
    ...args: string[]
  ) => (console: unknown) => Promise<void>;

  expect(errors).toEqual([]);
  await new AsyncFunction('console', code)({ log });

  return output;
}

describe('wrapped errors', () => {
  it('end with the message of the cause, and keep it', async () => {
    expect(
      await run(`func find(id number) (string, error) {
    return "", error(\`no user \${id}\`)
}

func load(id number) (string, error) {
    const name, err = find(id)
    if err != null {
        return "", error("load user", err)
    }
    return name, null
}

const name, err = load(7)
console.log(err?.message)
console.log(err?.cause.message)
const outer = error("serve", error("load user", error("timeout")))
console.log(outer.message)
try {
    JSON.parse("{")
} catch e {
    console.log(error("parse", e).cause instanceof SyntaxError)
}`),
    ).toEqual(['load user: no user 7', 'no user 7', 'serve: load user: timeout', 'true']);
  });

  it('wrap an error that is not null', () => {
    expect(
      compiled('func f(err error) error {\n    return error("load user", err)\n}').errors,
    ).toEqual(['cannot use error as Error in argument 2: it may be null, check it first']);
    expect(compiled('const e = error("a", "b")').errors).toEqual([
      'cannot use string as Error in argument 2',
    ]);
  });

  it('compile to $$wrap, and an error alone to new Error', () => {
    const { code } = compiled('const cause = error("timeout")\nconst e = error("load", cause)');

    expect(code).toContain('const cause = new Error("timeout");');
    expect(code).toContain('const e = $$wrap("load", cause);');
  });
});
