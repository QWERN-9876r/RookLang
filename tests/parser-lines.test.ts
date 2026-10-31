import { describe, expect, it } from 'vitest';
import type * as ast from '../src/ast.ts';
import { compile } from '../src/index.ts';
import { errors, first, statements, sx } from './parser-helpers.ts';

// Where lines end and what words mean: `>` and `?` at the ends and starts of lines, results that
// are object types, the parameters of function types, and `type` as a name.

/** The JS of a module, compiled without imports; it must have no errors. */
function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics.map((d) => d.message)).toEqual([]);

  return code;
}

describe('the end of a line', () => {
  it('ends a declaration after the > of type arguments', () => {
    const [store, pool] = statements(`class Store {
    votes ?Map<string, number>
    count = 0
}
interface Pool {
    pick(n number) Promise<string>
    size() number
}`);

    expect((store as ast.ClassDeclaration).members.map((member) => member.kind)).toEqual([
      'FieldDeclaration',
      'FieldDeclaration',
    ]);
    expect((pool as ast.InterfaceDeclaration).members).toHaveLength(2);
  });

  it('keeps a comparison whose > ends the line going, as other operators', () => {
    expect(js('const a = 2\nconst b = 1\nconst big = a >\n    b\nconsole.log(big)')).toContain(
      'const big = a > b;',
    );
  });

  it('continues a conditional expression on lines that start with ? and :', () => {
    const declaration = first(
      'const s = ok\n    ? "yes"\n    : big\n        ? "big"\n        : "no"',
      'VariableDeclaration',
    );

    expect(sx(declaration.values[0]!)).toBe('(? ok "yes" (? big "big" "no"))');
  });

  it('still ends the line before ??, which stays at the end of the line', () => {
    expect(errors('const a = b\n    ?? c')).toEqual(['expected expression, found "??"']);
  });
});

describe('results and parameters of functions', () => {
  it('reads an object type as the result when the body follows it', () => {
    const fn = first(
      'func names() { [string]: string } {\n    return { a: "b" }\n}',
      'FuncDeclaration',
    );

    expect(fn.results.map((result) => result.kind)).toEqual(['ObjectType']);
    expect(first('func run() {\n    [1, 2].forEach(f)\n}', 'FuncDeclaration').results).toEqual([]);
    expect(js('const f func() { [string]: number } = () => ({ a: 1 })')).toContain('const f');
  });

  it('groups the parameters of a function type by the rule of Go', () => {
    expect(js('func apply(f func(a, b number) number) number {\n    return f(1, 2)\n}')).toContain(
      'function apply(f)',
    );
    expect(errors('const f func(a, b) number = g')).toEqual([]);
    expect(errors('let f func(a, b number, c) number')).toEqual([
      'parameter "c" has no type: write it after the name, e.g. func(a, b number)',
    ]);
  });
});

describe('mistakes that get a hint', () => {
  it('reports type arguments of a call, which are inferred', () => {
    const hint =
      'a call takes no type arguments: they are inferred from the arguments and the expected type; give the variable a type instead, e.g. const done Promise<void> = new Promise(...)';

    expect(errors('const n = load<number>(1)')).toEqual([hint]);
    expect(errors('async func f() {\n    const n = await load<number>(1)\n}')).toEqual([hint]);
    expect(errors('const p = new Promise<void>(resolve => resolve())')).toEqual([hint]);
    expect(errors('const ok = a < b && c > (d)')).toEqual([]);
  });

  it('reports ++ in a template and several results of a conditional expression', () => {
    expect(errors('let x = 0\nconst s = `n${x++}`')).toEqual([
      '"++" is a statement and cannot be used inside a template: use x here and write x++ on a line of its own',
    ]);
    expect(errors('const n, err = ok ? two() : one()')).toEqual([
      'a conditional expression gives one value, not the results of a call: unpack them in the branches of if/else, e.g. if ok { a, err = two() } else { a, err = other() }',
    ]);
  });
});

describe('type as a name', () => {
  it('declares a type only at the start of a statement', () => {
    expect(first('type Id string', 'TypeAliasDeclaration').name.name).toBe('Id');
    expect(
      first('export type Pair<A, B any> { first A; second B }', 'TypeAliasDeclaration').exported,
    ).toBe(true);
    expect(
      js(`func info(blob Blob, type string) string {
    const kind = blob.type
    const o = { size: blob.size, type }
    return \`\${kind}\${o.type}\${type}\`
}`),
    ).toContain('const o = { size: blob.size, type };');
  });
});
