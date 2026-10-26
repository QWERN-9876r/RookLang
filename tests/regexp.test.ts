import { describe, expect, it } from 'vitest';
import { compile as compileInBrowser } from '../src/browser.ts';
import { compile } from '../src/index.ts';
import { tokenize } from '../src/lexer/lexer.ts';
import { expr } from './parser-helpers.ts';

// Regular expression literals, `/ab+c/gi`, as in JS: where a value cannot end, `/` starts one,
// and after a value it divides.

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function kinds(source: string): string[] {
  return tokenize(source).tokens.map((token) =>
    token.kind === 'RegExp' ? token.text : token.kind,
  );
}

describe('lexing', () => {
  it('tells a regular expression from a division', () => {
    expect(kinds('a / b / c')).toEqual([
      'Identifier',
      '/',
      'Identifier',
      '/',
      'Identifier',
      ';',
      'EOF',
    ]);
    expect(kinds('x = /a\\/b[/]c/gi')).toEqual(['Identifier', '=', '/a\\/b[/]c/gi', ';', 'EOF']);
    expect(kinds('f(/=/)')).toEqual(['Identifier', '(', '/=/', ')', ';', 'EOF']);
    expect(kinds('n /= 2')).toEqual(['Identifier', '/=', 'Number', ';', 'EOF']);
    expect(kinds('return /x/')).toEqual(['return', '/x/', ';', 'EOF']);
    expect(kinds('`${/x/}`')).toEqual(['TemplateHead', '/x/', 'TemplateTail', ';', 'EOF']);
    expect(kinds('xs[0] / 2')).toEqual([
      'Identifier',
      '[',
      'Number',
      ']',
      '/',
      'Number',
      ';',
      'EOF',
    ]);
  });

  it.each([
    ['x = /(/', 'invalid regular expression: unterminated group'],
    [
      'x = /a/gg',
      'invalid flags "gg" of a regular expression: each of d, g, i, m, s, u, v and y goes once, and not u with v',
    ],
    [
      'x = /a/uv',
      'invalid flags "uv" of a regular expression: each of d, g, i, m, s, u, v and y goes once, and not u with v',
    ],
    [
      'x = /a/q',
      'invalid flags "q" of a regular expression: each of d, g, i, m, s, u, v and y goes once, and not u with v',
    ],
    ['x = /abc\ny = 1', 'unterminated regular expression: end it with "/"'],
  ])('reports %j', (source, message) => {
    expect(tokenize(source).diagnostics.map((d) => d.message)).toEqual([message]);
  });
});

describe('parsing and checking', () => {
  it('is a RegExp', () => {
    expect(expr('/a+/g')).toMatchObject({ kind: 'RegExpLiteral', pattern: 'a+', flags: 'g' });
    expect(
      errors(
        'const r RegExp = /a+/g\nconst ok bool = r.test("aa")\nconsole.log("a-b".replace(/-/g, "+"), ok, r.flags)',
      ),
    ).toEqual([]);
    expect(errors('const n number = /a/')).toEqual(['cannot use RegExp as number']);
  });

  it('is untyped in the browser, which has no lib files', () => {
    expect(compileInBrowser('const n number = /a/').diagnostics).toEqual([]);
  });
});

describe('generated code', () => {
  it('is written as it is', () => {
    const { code } = compile('const word = /\\b[a-z]+\\b/gi\nconsole.log("Hi there".match(word))');

    expect(code).toContain('const word = /\\b[a-z]+\\b/gi;');
  });
});
