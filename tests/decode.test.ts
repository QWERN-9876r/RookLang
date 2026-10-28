import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as syntaxErrors, expr, sx } from './parser-helpers.ts';
import { moduleProject } from './project.ts';

// `decode<T>(x)`: JSON text, or a value from JS, checked against a type when the program runs. The
// type becomes data in the JS (codegen/decode.ts), which runtime/decode.js checks the value against.

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

/** Prints the value of `decode<T>` of each input, or its error. */
function decodes(type: string, inputs: string[], declarations = ''): Promise<string[]> {
  return run(`${declarations}
for input in ${JSON.stringify(inputs)} {
    const value, err = decode<${type}>(input)
    console.log(err != null ? err.message : JSON.stringify(value))
}`);
}

const USER = `interface User {
    name string
    age number
    tags []string
    role "admin" | "user"
    boss ?User
}
`;

describe('parsing', () => {
  it('reads decode<T>(x), and keeps decode a name elsewhere', () => {
    expect(sx(expr('decode<User>(body)'))).toBe('(decode User body)');
    expect(sx(expr('decode<[]?number>(f(x))'))).toBe('(decode []?number (call f x))');
    expect(sx(expr('decode < n'))).toBe('(< decode n)');
    expect(sx(expr('decode(x)'))).toBe('(call decode x)');
    expect(syntaxErrors('const user, err = decode<User>(body)')).toEqual([]);
    expect(syntaxErrors('const user = decode<User>()')).toEqual([
      'decode takes JSON text or a value from JS, e.g. decode<User>(body)',
    ]);
  });
});

describe('checking', () => {
  it('gives the value and an error', () => {
    expect(
      errors(`${USER}
func load(body string) (User, error) {
    const user, err = decode<User>(body)
    if err != null {
        return null, err
    }
    return user, null
}
const n, err = decode<number>("1")
const sum number = n + 1`),
    ).toEqual(['cannot add ?number and number: a value may be null, check it first']);
    expect(errors('const user = decode<number>("1")')).toEqual([
      'decode returns 2 values: unpack them, e.g. "const a, b = ..."',
    ]);
  });

  it('takes JSON text or a value from JS, and no other type', () => {
    expect(errors('const v, err = decode<number>(JSON.parse("1"))')).toEqual([]);
    expect(errors('const s "a" | "b" = "a"\nconst v, err = decode<number>(s)')).toEqual([]);
    expect(errors('const v, err = decode<number>(1)')).toEqual([
      'decode takes JSON text, a string, or a value of type any from JS, not number; its type is known already',
    ]);
    expect(errors('func f(s ?string) {\n    const v, err = decode<number>(s)\n}')).toEqual([
      'decode takes JSON text, a string, or a value of type any from JS, not ?string: the text may be null, so check it first, e.g. "if text != null"',
    ]);
    expect(errors('const v, err = decode<number>([]byte("1"))')).toEqual([
      'decode takes JSON text, a string, or a value of type any from JS, not []byte: make the text of the bytes first, e.g. decode<User>(string(data))',
    ]);
  });

  it('decodes only what JSON can hold', () => {
    const check = (type: string, declarations = '') =>
      errors(`${declarations}\nconst v, err = decode<${type}>("null")`);

    expect(check('?(number | string | bool)')).toEqual([]);
    expect(check('[]{ x, y number }')).toEqual([]);
    expect(check('Tree', 'interface Tree { value number; children []Tree }')).toEqual([]);
    expect(check('Box<string>', 'interface Box<T> { value T }')).toEqual([]);
    expect(check('Date')).toEqual([
      'cannot decode Date: JSON has no Date: decode a string and make the Date from it, e.g. new Date(s)',
    ]);
    expect(check('bigint')).toEqual([
      'cannot decode bigint: JSON has no bigint: decode a string and make it with BigInt(s)',
    ]);
    expect(check('[]byte')).toEqual(['cannot decode []byte: JSON has no []byte']);
    expect(check('Point', 'class Point { x number }')).toEqual([
      'cannot decode Point: decode gives plain objects, without the methods of the class Point: decode an interface with its fields',
    ]);
    expect(check('Shape', 'interface Shape { area() number }')).toEqual([
      'cannot decode Shape: Shape has methods, and JSON gives only data: decode an interface with its fields',
    ]);
    expect(check('Handler', 'interface Handler { name string; run func() }')).toEqual([
      'cannot decode Handler: a function cannot come from JSON',
    ]);
    expect(check('chan number')).toEqual([
      'cannot decode chan number: a channel cannot come from JSON',
    ]);
    expect(
      errors(`${USER}\nfunc parse(text string) (User, error) {\n    return decode<User>(text)\n}`),
    ).toEqual([]);
    expect(
      errors('func parse<T any>(text string) (T, error) {\n    return decode<T>(text)\n}'),
    ).toEqual([
      'cannot decode T: T is a type parameter: decode needs a type known when the program compiles',
    ]);
  });

  it('says how to write decode without its type', () => {
    expect(errors('const v = decode("1")')).toEqual([
      'decode takes the type first, e.g. decode<User>(body)',
    ]);
    expect(errors('func decode(s string) string { return s }\nconst v = decode("1")')).toEqual([]);
  });
});

describe('the generated code', () => {
  it('writes object types as constants before the code, and the others in place', () => {
    const code = js(`${USER}
const user, err = decode<User>("{}")
const ids, idsErr = decode<[]?number>(JSON.parse("[]"))`);

    expect(code).toContain(`const $$typeUser = $$type("User", () => ({
  name: "string",
  age: "number",
  tags: { array: "string" },
  role: { literal: ["admin", "user"] },
  boss: { nullable: $$typeUser },
}));

const [user, err] = $$decodeJson("{}", $$typeUser);
const [ids, idsErr] = $$decode(JSON.parse("[]"), { array: { nullable: "number" } });`);
  });

  it('names the instances of a generic type and the types without a name apart', () => {
    const code = js(`interface Box<T> { value T }
const a, e1 = decode<Box<number>>("{}")
const b, e2 = decode<Box<string>>("{}")
const c, e3 = decode<{ x number }>("{}")`);

    expect(code).toContain('const $$typeBox = $$type("Box<number>", () => ({\n  value: "number",');
    expect(code).toContain('const $$typeBox2 = $$type("Box<string>", () => ({\n  value: "string",');
    expect(code).toContain('const $$typeObject = $$type("{ x number }", () => ({\n  x: "number",');
  });

  it('checks nothing without the types of the checker', () => {
    const { code } = compile('const v, err = decode<number>(text)', { typeCheck: false });

    expect(code).toContain('const [v, err] = $$decode(text, null);');
  });
});

describe('running', () => {
  it('returns a value that fits as it is, with fields the type does not have', async () => {
    expect(
      await decodes(
        'User',
        [
          '{"name": "Ann", "age": 42, "tags": ["a"], "role": "admin", "extra": true}',
          '{"name": "Bob", "age": 7, "tags": [], "role": "user", "boss": {"name": "Ann", "age": 42, "tags": [], "role": "admin", "boss": null}}',
        ],
        USER,
      ),
    ).toEqual([
      '{"name":"Ann","age":42,"tags":["a"],"role":"admin","extra":true}',
      '{"name":"Bob","age":7,"tags":[],"role":"user","boss":{"name":"Ann","age":42,"tags":[],"role":"admin","boss":null}}',
    ]);
  });

  it('says where the value does not fit', async () => {
    expect(
      await decodes(
        'User',
        [
          '[1]',
          '{"age": 42, "tags": [], "role": "admin"}',
          '{"name": "Ann", "age": "42", "tags": [], "role": "admin"}',
          '{"name": "Ann", "age": 42, "tags": ["a", 1], "role": "admin"}',
          '{"name": "Ann", "age": 42, "tags": [], "role": "root"}',
          '{"name": "Bob", "age": 7, "tags": [], "role": "user", "boss": {"name": "Ann"}}',
          '{"name": "Bob", "age": 7, "tags": [], "role": "user", "boss": 1}',
          '{"name": ',
        ],
        USER,
      ),
    ).toEqual([
      'decode User: expected User, got an array',
      'decode User: name: missing',
      'decode User: age: expected number, got "42"',
      'decode User: tags[1]: expected string, got 1',
      'decode User: role: expected "admin" | "user", got "root"',
      'decode User: boss.age: missing',
      'decode User: boss: expected ?User, got 1',
      expect.stringMatching(/^decode User: invalid JSON: /),
    ]);
  });

  it('decodes numbers, strings, unions and literals', async () => {
    expect(
      await decodes('?(number | []string)', ['1', 'null', '["a"]', '"a"', '[1]', 'true']),
    ).toEqual([
      '1',
      'null',
      '["a"]',
      'decode ?(number | []string): expected ?(number | []string), got "a"',
      'decode ?(number | []string): [0]: expected string, got 1',
      'decode ?(number | []string): expected ?(number | []string), got true',
    ]);
    expect(await decodes('[]bool', ['[true, false]', '[0]'])).toEqual([
      '[true,false]',
      'decode []bool: [0]: expected bool, got 0',
    ]);
    expect(await decodes('"a" | 2 | true', ['"a"', '2', 'true', '"b"'])).toEqual([
      '"a"',
      '2',
      'true',
      'decode "a" | 2 | true: expected "a" | 2 | true, got "b"',
    ]);
    expect(await decodes('any', ['{"a": [1]}', 'x'])).toEqual([
      '{"a":[1]}',
      expect.stringMatching(/^decode any: invalid JSON: /),
    ]);
  });

  it('reports the member of a union that the value is closest to', async () => {
    const shapes = `interface Circle { kind "circle"; r number }
interface Square { kind "square"; side number }
`;

    expect(
      await decodes(
        'Circle | Square',
        ['{"kind": "square", "side": 2}', '{"kind": "circle", "r": "2"}', '{"kind": "oval"}'],
        shapes,
      ),
    ).toEqual([
      '{"kind":"square","side":2}',
      'decode Circle | Square: r: expected number, got "2"',
      'decode Circle | Square: kind: expected "circle", got "oval"',
    ]);
  });

  it('lets nullable fields be missing, and reads only own fields', async () => {
    expect(
      await decodes(
        'Point',
        ['{"x": 1}', '{"x": 1, "label": "a", "data": {}}', '{"x": 1, "label": 2}', '{"y": 1}'],
        'interface Point { x number; label ?string; data any }',
      ),
    ).toEqual([
      '{"x":1}',
      '{"x":1,"label":"a","data":{}}',
      'decode Point: label: expected ?string, got 2',
      'decode Point: x: missing',
    ]);
    expect(
      await decodes('Named', ['{}', '{"toString": "a"}'], 'interface Named { toString string }'),
    ).toEqual(['decode Named: toString: missing', '{"toString":"a"}']);
  });

  it('checks a value from JS without parsing it', async () => {
    expect(
      await run(`interface Point { x, y number }
const values []any = [{ x: 1, y: 2 }, "{}", null]
for value in values {
    const point, err = decode<Point>(value)
    console.log(err != null ? err.message : point.x + point.y)
}`),
    ).toEqual([
      '3',
      'decode Point: expected Point, got "{}"',
      'decode Point: expected Point, got null',
    ]);
  });

  it('decodes types that refer to each other', async () => {
    expect(
      await decodes(
        'Tree',
        [
          '{"value": 1, "children": [{"value": 2, "children": []}]}',
          '{"value": 1, "children": [{"value": 2}]}',
        ],
        'interface Tree { value number; children []Tree }',
      ),
    ).toEqual([
      '{"value":1,"children":[{"value":2,"children":[]}]}',
      'decode Tree: children[0].children: missing',
    ]);
  });

  // The inline runtime has functions of its own named so, which the program must not replace.
  it('works next to functions of the program named check and describe', async () => {
    expect(
      await run(`interface Point { x, y number }
func describe(p Point) string {
    return \`(\${p.x}, \${p.y})\`
}
func check(json string) string {
    const point, err = decode<Point>(json)
    return err != null ? err.message : describe(point)
}
console.log(check("{\\"x\\": 1, \\"y\\": 2}"))
console.log(check("{\\"x\\": 1}"))`),
    ).toEqual(['(1, 2)', 'decode Point: y: missing']);
  });
});

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

describe('goroutines', () => {
  it('decode in a goroutine, whose worker module has the types it needs', () => {
    const dir = moduleProject('rook-decode-');
    const options = { cwd: dir, encoding: 'utf8' as const, timeout: 20_000 };

    writeFileSync(
      join(dir, 'main.rk'),
      `interface Point { x, y number }

func length(text string) number {
    const point, err = decode<Point>(text)
    if err != null {
        return -1
    }
    return Math.hypot(point.x, point.y)
}

console.log(await go length(\`{"x": 3, "y": 4}\`), await go length("{}"))
`,
    );
    expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], options).stderr).not.toContain(
      'error:',
    );

    const { stdout, stderr } = spawnSync(process.execPath, ['main.js'], options);

    expect(stderr).toBe('');
    expect(stdout).toBe('5 -1\n');
  });
});
