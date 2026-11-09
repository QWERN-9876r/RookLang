import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { tokenize } from '../src/lexer/lexer.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';
import { first, errors as syntaxErrors, sx } from './parser-helpers.ts';

// `for i in 0..n`: the numbers from 0 up to n, without n. A loop of JS, whose end is computed once;
// `{for}` of markup goes over the array of them.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

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

describe('ranges', () => {
  it('are two dots between numbers, apart from the dot of a fraction', () => {
    expect(tokenize('0..20 1.5..n').tokens.map((token) => token.kind)).toEqual([
      'Number',
      '..',
      'Number',
      'Number',
      '..',
      'Identifier',
      ';',
      'EOF',
    ]);
  });

  it('are written after "in" of a loop, with one variable', () => {
    const loop = first('for i in 1..n + 1 {\n}', 'ForInStatement');

    expect(sx(loop.iterable)).toBe('(.. 1 (+ n 1))');
    expect(syntaxErrors('for i, x in 0..3 {\n}')).toEqual([
      'a range gives one value, the number: write "for i in ..."',
    ]);
    expect(syntaxErrors('go for i in 0..3 {\n}')).toEqual([
      '"go for" goes over an array: write the loop without go, or "go for i, v in items"',
    ]);
  });

  it('take numbers and give a number that the loop cannot change', () => {
    expect(errors('for i in 0..3 {\n    const n number = i\n}')).toEqual([]);
    expect(
      errors('for i in 0.."3" {\n}\nfor i in 0..3 {\n    const s string = i\n    i = 5\n}'),
    ).toEqual([
      'cannot use string as number',
      'cannot use number as string',
      'cannot assign to loop variable "i"',
    ]);
  });

  it('compile to a loop of JS whose end is computed once', () => {
    expect(js('let n = 2\nfor i in 1..n {\n    n = 10\n}\nfor j in 0..3 {\n}')).toBe(
      `let n = 2;
for (let i = 1, $$end = n; i < $$end; i++) {
  n = 10;
}
for (let j = 0; j < 3; j++) {}
`,
    );
    expect(
      run(`let n = 3
outer: for i in 0..n {
    n = 10
    for j in i..3 {
        if j == 2 {
            continue outer
        }
        console.log(i, j)
    }
}
for i in 5..2 {
    console.log("never")
}`),
    ).toEqual(['0 0', '0 1', '1 1']);
  });

  it('go over an array of the numbers in {for} of markup', () => {
    const { body } = mountWithDom(`comp Stars(n number) {
    return <p>{for i in 0..n { <b>{i}</b> }}</p>
}
document.body.append(<Stars n={3} />)
`);

    expect(String(body)).toBe('<body><p><b>0</b><b>1</b><b>2</b></p></body>');
  });
});
