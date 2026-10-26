import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as parseErrors, inFunction } from './parser-helpers.ts';

// `if const v, err = f(); err != null { }` and `switch const k = f(); k { }`: the variables of the
// initializer are seen in every branch, else included, and not after the statement, as in Go.

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  return code;
}

/** Runs compiled code; returns what it printed. */
function run(source: string): string[] {
  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const program = new Function('console', js(source)) as (console: { log: typeof log }) => void;

  program({ log });

  return output;
}

const PARSE = `func parse(s string) (number, ?error) {
    const n = parseInt(s)
    if isNaN(n) {
        return 0, error(\`not a number: \${s}\`)
    }
    return n, null
}

func describe(s string) string {
    if const n, err = parse(s); err != null {
        return err.message
    } else if let twice = n * 2; twice > 10 {
        return \`big \${twice}\`
    } else {
        return \`small \${n}\`
    }
}
`;

describe('parsing', () => {
  it('reads the initializer of if, else if and switch', () => {
    const [statement] = inFunction('if const v = f(); v > 0 {\n} else if let w = g(); w {\n}');

    expect(statement).toMatchObject({
      kind: 'IfStatement',
      init: { kind: 'VariableDeclaration', keyword: 'const', names: [{ name: 'v' }] },
      alternate: { init: { keyword: 'let', names: [{ name: 'w' }] } },
    });
    expect(inFunction('switch const k = f(); k {\n}')[0]).toMatchObject({
      kind: 'SwitchStatement',
      init: { names: [{ name: 'k' }] },
      discriminant: { name: 'k' },
    });
    expect(inFunction('switch const k = f(); {\n}')[0]).toMatchObject({ discriminant: null });
    expect(inFunction('if x > 0 {\n}')[0]).toMatchObject({ init: null });
  });

  it('reports a missing ";" and an initializer in markup', () => {
    expect(parseErrors('func f() {\n    if const v = 1 {\n    }\n}')).toContain(
      'expected ";" after the initializer of if, found "{"',
    );
    expect(
      errors(
        'comp A(xs []number) {\n    return <p>{if const n = xs.length; n > 0 {\n        <b>{n}</b>\n    }}</p>\n}',
      ),
    ).toContain('the if of markup has no initializer: declare the variable before the markup');
  });
});

describe('checking', () => {
  it('sees the variables in every branch and not after the statement', () => {
    expect(errors(PARSE)).toEqual([]);
    expect(
      errors(`${PARSE}func g() number {\n    if const n = 1; n > 0 {\n    }\n    return n\n}`),
    ).toEqual(['"n" is not defined']);
    expect(errors('func f() {\n    if const n = 1; n > 0 {\n        n = 2\n    }\n}')).toEqual([
      'cannot assign to "n": it is a constant',
    ]);
  });

  it('narrows the variables of the initializer', () => {
    expect(
      errors(
        'func find() ?string {\n    return null\n}\nfunc f() number {\n    if const s = find(); s != null {\n        return s.length\n    }\n    return 0\n}',
      ),
    ).toEqual([]);
  });
});

describe('generated code', () => {
  it('keeps the variables in a block around the statement', () => {
    expect(js(PARSE)).toContain(`  {
    const [n, err] = parse(s);
    if (err != null) {
      return err.message;
    } else {
      let twice = n * 2;
      if (twice > 10) {`);
    expect(
      js(
        'func f(x number) string {\n    switch const half = x / 2; half {\n    case 1:\n        return "one"\n    }\n    return "many"\n}',
      ),
    ).toContain(`  {
    const half = x / 2;
    switch (half) {
      case 1:
        return "one";
    }
  }`);
  });

  it('runs', () => {
    expect(run(`${PARSE}console.log(describe("x"), describe("12"), describe("2"))`)).toEqual([
      'not a number: x big 24 small 2',
    ]);
  });
});
