import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { runWithDom } from './fake-dom.ts';
import { errors as parseErrors, first, sx } from './parser-helpers.ts';

// What follows a value: a tagged template, sql`select ... ${id}`, which calls it with the strings
// and the values, and `user!`, which takes it not to be null, as in TypeScript.

function errors(source: string): string[] {
  return compile(source, { runtime: 'inline' }).diagnostics.map((d) => d.message);
}

describe('tagged templates', () => {
  it('call the tag with the strings and the values', () => {
    expect(
      runWithDom(`func sql(parts TemplateStringsArray, ...values []any) string {
    return \`\${parts.join("?")} \${values.join(",")}\`
}
const id = 7
console.log(sql\`select * from users where id = \${id} and name = \${"Ann"}\`)`),
    ).toEqual(['select * from users where id = ? and name = ? 7,Ann']);
  });

  it('are a tag only on the same line', () => {
    expect(sx(first('const q = db.sql`select ${id}`', 'VariableDeclaration').values[0]!)).toBe(
      '(tag (. db sql) (` "select " id ""))',
    );
    expect(parseErrors('const q = sql\n`select`')).toEqual([
      'this expression does nothing: only function calls can be used as statements',
    ]);
  });

  it('check the values against the parameters of the tag', () => {
    expect(
      errors(`func two(parts []string, a number, b string) string {
    return parts[0]
}
const n number = two\`\${1}\${"x"}\`
const bad = two\`\${"x"}\${1}\`
const many = two\`\${1}\${"x"}\${2}\`
const no = 5\`x\``),
    ).toEqual([
      'cannot use string as number',
      'cannot use string as number in value 1',
      'cannot use number as string in value 2',
      'too many values for the tag: it takes 2 after the strings',
      'number cannot be a tag: a tag is a function, e.g. func sql(parts TemplateStringsArray, ...values []any)',
    ]);
  });
});

describe('non-null', () => {
  it('takes a value not to be null, and leaves nothing in JS', () => {
    const { code, diagnostics } = compile(
      `func port(env { [string]: string }, user ?{ name string }) string {
    const value string = env["PORT"]!
    const name = user!.name
    return value + name
}`,
      { runtime: 'inline' },
    );

    expect(diagnostics).toEqual([]);
    expect(code).toContain('const value = env["PORT"];');
    expect(code).toContain('const name = user.name;');
  });

  it('is the ! right after a value, and ends a line', () => {
    expect(sx(first('const a = b! && !c', 'VariableDeclaration').values[0]!)).toBe(
      '(&& (! b) (! c))',
    );
    expect(parseErrors('const a = b!\nconst c = !d')).toEqual([]);
  });
});
