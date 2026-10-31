import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { runWithDom } from './fake-dom.ts';
import { errors as parseErrors } from './parser-helpers.ts';

// Objects as in JS: the fields of one in variables, `const { name, size: bytes, ...rest } = file`,
// and methods in an object literal, `{ fetch(req Request) Response { ... } }`.

function errors(source: string): string[] {
  return compile(source, { runtime: 'inline' }).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics.map((d) => d.message)).toEqual([]);

  return code;
}

const file = `interface File {
    name string
    size number
    kind string
}
const file File = { name: "a.txt", size: 3, kind: "text" }
`;

describe('destructuring', () => {
  it('takes fields into variables, renamed ones and the rest', () => {
    expect(
      runWithDom(`${file}const { name, size: bytes, ...rest } = file
let { kind: type } = file
type = type.toUpperCase()
const headers { [string]: string } = { "content-type": "json" }
const { "content-type": mime } = headers
const n number = bytes
console.log(name, n, rest.kind, type, mime)`),
    ).toEqual(['a.txt 3 text TEXT json']);
    expect(js(`${file}const { name, size: bytes, ...rest } = file`)).toContain(
      'const { name, size: bytes, ...rest } = file;',
    );
  });

  it('checks the fields, methods and null', () => {
    expect(
      errors(`${file}const { missing } = file
const { toUpperCase } = file.name
const maybe ?File = null
const { size } = maybe
const { kind } = file
const k number = kind`),
    ).toEqual([
      'File has no member "missing"',
      '"toUpperCase" is a method: call it on the object, e.g. object.toUpperCase()',
      'cannot take the fields of ?File: it may be null, check it first',
      'cannot use string as number',
    ]);
  });

  it('is one level of names, with a value', () => {
    expect(parseErrors('const { a, ...rest, b } = o')).toEqual([
      '...rest is the last name: it gets the other fields',
    ]);
    expect(parseErrors('const { "a-b" } = o')).toEqual([
      '"a-b" needs a name to take its value, e.g. { "a-b": name }',
    ]);
    expect(parseErrors('let { a }')).toEqual([
      'expected "=" and the object: a pattern takes its fields from a value, found newline',
    ]);
  });
});

describe('methods in object literals', () => {
  it('are methods of JS, typed as func literals', () => {
    expect(
      runWithDom(`interface Handler {
    fetch(url string) string
    count number
}
const prefix = ">"
const h Handler = {
    count: 1,
    fetch(url string) string {
        return prefix + url
    },
}
const api = {
    "with-dash"() string {
        return "d"
    },
}
console.log(h.fetch("x"), api["with-dash"]())`),
    ).toEqual(['>x d']);
    expect(
      js('const api = {\n    async load(n number) number {\n        return n\n    },\n}'),
    ).toContain('async load(n) {');
  });

  it('check their types against the expected ones, and have no this of a class', () => {
    expect(
      errors(`interface Handler {
    fetch(url string) string
}
const h Handler = {
    fetch(url number) string {
        return ""
    },
}
class Server {
    port = 1
    handler() {
        const o = {
            run() number {
                return this.port
            },
        }
    }
}`),
    ).toEqual([
      'cannot use func(number) string as func(string) string for field "fetch"',
      '"this" can only be used inside a class',
    ]);
  });
});
