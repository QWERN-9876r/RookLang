import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../src/build.ts';
import { compile } from '../src/index.ts';
import { errors as syntaxErrors, expr, sx } from './parser-helpers.ts';

// `make(File)`: the value of a type, computed when the program compiles. In a generic function,
// `make(T)` and `decode<T>` take T from the calls, `create<number>()`: the value is written into
// a function called with one type, passed to one called with several, and a function never called
// is left out (docs/spec.md, "make").

function js(source: string): string {
  const { code, diagnostics } = compile(source);

  expect(diagnostics).toEqual([]);

  return code;
}

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function warnings(source: string): string[] {
  return compile(source).warnings.map((d) => d.message);
}

/** Runs compiled code; returns what it printed. */
function run(source: string): string[] {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map((a) => JSON.stringify(a)).join(' '));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const program = new Function('console', code) as (console: { log: typeof log }) => void;

  program({ log });

  return output;
}

const FILE = `interface File {
    name string
    size number
    type ?string
}
`;

const CREATE = `func create<T>() T {
    return make(T)
}
`;

describe('make of a type', () => {
  it('reads a type, and type arguments of calls', () => {
    expect(sx(expr('make(File)'))).toBe('(make File)');
    expect(sx(expr('make(File[])'))).toBe('(make File[])');
    expect(sx(expr('make(x, 1)'))).toBe('(call make x 1)');
    expect(sx(expr('create<number>()'))).toBe('(call<number> create)');
    expect(sx(expr('store.load<User, ?string>(a)'))).toBe('(call<User, ?string> (. store load) a)');
    expect(sx(expr('a < b && c > (d)'))).toBe('(&& (< a b) (> c d))');
    expect(syntaxErrors('const x = make(File')).not.toEqual([]);
  });

  it('is the value of the type, with no type in the JS', () => {
    expect(
      js(`${FILE}
type MyNumber number
interface Circle {
    kind "circle"
    center Point
}
interface Point {
    x, y number
}
class Cart {
    items string[] = []
}
const a1 = make(File)
const a2 = make(File[])
const b3 = make(number)
const b4 = make(MyNumber)
const c = make(Circle)
const d = make(Cart)
const e = make(Map<string, number>)
const f = make(float64[])
const g = make(?string)`),
    ).toContain(`const a1 = { name: "", size: 0 };
const a2 = [];
const b3 = 0;
const b4 = 0;
const c = { kind: "circle", center: { x: 0, y: 0 } };
const d = new Cart();
const e = new Map();
const f = new Float64Array();
const g = null;`);
  });

  it('says why a type has no value', () => {
    expect(
      errors(`type Filter "all" | "done"
interface Shape {
    area() number
}
interface Node {
    next Node
}
class Point {
    constructor(public x number) {}
}
const a = make(Filter)
const b = make(Shape)
const c = make(Node)
const d = make(Point)
const e = make(func() number)`),
    ).toEqual([
      'cannot make Filter: Filter is a union, which has no value of its own; give the value, e.g. const x Filter = ...',
      'cannot make Shape: Shape has the method "area", which has no value of its own',
      'cannot make Node: field "next": Node has itself as a field; make the field nullable, e.g. next ?Node',
      'cannot make Point: the constructor of Point takes arguments; call it, e.g. new Point(...)',
      'cannot make func() number: func() number is a function, which has no value of its own',
    ]);
    expect(errors('func make(x number) number {\n    return x\n}\nconst a = make(number)')).toEqual(
      [
        'make(...) makes the value of a type, so the name "make" is taken; rename the value, e.g. makeItem',
      ],
    );
  });

  it('makes a new value each time', () => {
    expect(
      run(`${FILE}
const a = make(File)
const b = make(File)
a.name = "a"
console.log(b.name, a == b)`),
    ).toEqual(['"" false']);
  });
});

describe('make(T) in a generic function', () => {
  it('writes the value into a function called with one type', () => {
    expect(js(`${CREATE}const num = create<number>()`)).toBe(`function create() {
  return 0;
}
const num = create();
`);
  });

  it('passes a function that makes the value to one called with several', () => {
    expect(
      js(`${FILE}${CREATE}
func pair<T>() T[] {
    return [create<T>(), create<T>()]
}
const num = create<number>()
const str = create<string>()
const files = pair<File>()
const nums = pair<number>()`),
    ).toContain(`function create($$Tmake) {
  return $$Tmake();
}

function pair($$Tmake) {
  return [create($$Tmake), create($$Tmake)];
}
const num = create(() => 0);
const str = create(() => "");
const files = pair(() => ({ name: "", size: 0 }));
const nums = pair(() => 0);`);
    expect(
      run(`${FILE}${CREATE}
func pair<T>() T[] {
    return [create<T>(), create<T>()]
}
const files = pair<File>()
const nums = pair<number>()
console.log(files, files[0] == files[1], nums)`),
    ).toEqual(['[{"name":"","size":0},{"name":"","size":0}] false [0,0]']);
  });

  it('infers T as other calls do', () => {
    expect(
      run(`func reset<T>(xs T[]) T[] {
    return xs.map(x => make(T))
}
const empty string[] = []
func fill<T>(n number) T[] {
    const out T[] = []
    for i in 0..n {
        out.push(make(T))
    }
    return out
}
const zeros number[] = fill(2)
console.log(reset([1, 2]), reset(["a"]), zeros, empty)`),
    ).toEqual(['[0,0] [""] [0,0] []']);
  });

  it('leaves out a function that is never called, with a warning', () => {
    const source = `${CREATE}
func twice<T>() T[] {
    return [create<T>(), create<T>()]
}
func plain<T>(x T) T {
    return x
}`;

    expect(js(source)).not.toContain('function create');
    expect(js(source)).toContain('function plain(x)');
    expect(warnings(source)).toEqual([
      '"create" is never called, so it is left out of the JS: make(T) needs the T of a call; call it, e.g. create<number>(), or remove it',
      '"twice" is never called, so it is left out of the JS: make(T) needs the T of a call; call it, e.g. twice<number>(), or remove it',
    ]);
  });

  it('reports what the calls cannot give', () => {
    expect(
      errors(`${CREATE}
class Point {
    constructor(public x number) {}
}
class Box<T> {
    value T = make(T)
}
func reset<T>() {
    const x = make(T)
}
const f = create
const g = create<number, string>()
const h = create<Point>()
const i = create()
reset()
const j = plainFunc<number>()
func plainFunc() number {
    return 1
}`),
    ).toEqual([
      'cannot make T: T of a class or a method is not known when the program compiles; make(T) takes the type parameters of a func, e.g. func create<T>() T { return make(T) }',
      '"create" cannot be used as a value: make(T) in it needs the T of each call; call it, e.g. () => create<number>()',
      'wrong number of type arguments: expected 1, got 2',
      'cannot make Point for T of create: the constructor of Point takes arguments; call it, e.g. new Point(...)',
      'cannot infer T: give it, e.g. create<number>(), or declare the type of the result',
      'cannot infer T of reset: give it, e.g. reset<number>()',
      'the function takes no type arguments; leave them out',
    ]);
  });

  it('checks the type arguments against the constraints', () => {
    expect(
      errors(`interface Named {
    name string
}
func blank<T Named>() T {
    return make(T)
}
const a = blank<Named>()
const b = blank<number>()`),
    ).toEqual(['number does not satisfy the constraint Named of T']);
  });
});

describe('decode<T> in a generic function', () => {
  it('takes the type that decode checks against from the calls', () => {
    const source = `interface User {
    name string
}
interface Box<T> {
    value T
}
func parse<T>(text string) ?T {
    const value, err = decode<T>(text)
    return value
}
func boxed<T>(text string) ?Box<T> {
    const box, err = decode<Box<T>>(text)
    return box
}
console.log(parse<number>("1"), parse<User>("{\\"name\\":1}"), boxed<string>("{\\"value\\":\\"a\\"}"))
console.log(boxed<number>("{\\"value\\":\\"a\\"}"))`;

    expect(js(source)).toContain(`function parse($$Ttype, text) {
  const [value, err] = $$decodeJson(text, $$Ttype);
  return value;
}`);
    expect(js(source)).toContain(
      'const [box, err] = $$decodeJson(text, $$type("Box<T>", () => ({ value: $$Ttype })));',
    );
    expect(run(source)).toEqual(['1 null {"value":"a"}', 'null']);
  });
});

describe('make(T) across modules', () => {
  it('passes the values to an exported function, which says so in its .d.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rook-make-'));

    writeFileSync(
      join(dir, 'lib.rk'),
      `export func fresh<T>() T[] {
    return [make(T)]
}
export func parse<T>(text string) (T, error) {
    return decode<T>(text)
}
`,
    );
    writeFileSync(
      join(dir, 'main.rk'),
      `import { fresh, parse } from "./lib.rk"
const a = fresh<number>()
const b, err = parse<string>("\\"x\\"")
`,
    );

    const { outputs, errors } = build([join(dir, 'main.rk')]);
    const code = (name: string) => outputs.find((each) => each.output.endsWith(name))!;

    expect(errors).toEqual([]);
    expect(code('lib.js').code).toContain(
      'export function fresh($$Tmake) {\n  return [$$Tmake()];',
    );
    expect(code('lib.js').declarations?.code).toContain(
      'export declare function fresh<T>($$Tmake: () => T): T[];\nexport declare function parse<T>($$Ttype: unknown, text: string)',
    );
    expect(code('main.js').code).toContain(
      'const a = fresh(() => 0);\nconst [b, err] = parse("string", "\\"x\\"");',
    );
  });
});
