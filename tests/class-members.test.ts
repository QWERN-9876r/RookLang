import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as parseErrors, first } from './parser-helpers.ts';

// Getters and setters, readonly fields, abstract classes and methods, and constructor parameters
// that are properties: `constructor(private name string)`.

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

const SHAPES = `abstract class Shape {
    constructor(readonly name string) { }

    abstract area() number

    describe() string {
        return \`\${this.name}: \${this.area()}\`
    }
}

class Square extends Shape {
    constructor(private side number) {
        super("square")
    }

    area() number {
        return this.side ** 2
    }

    get size() number {
        return this.side
    }

    set size(value number) {
        this.side = value
    }

    get perimeter() number {
        return this.side * 4
    }
}
`;

describe('parsing', () => {
  it('reads get, set, readonly and abstract, and keeps them names elsewhere', () => {
    const shape = first(SHAPES, 'ClassDeclaration');
    const [constructor, area] = shape.members;

    expect(shape.abstract).toBe(true);
    expect(
      constructor?.kind === 'ConstructorDeclaration' && constructor.params[0]?.property,
    ).toEqual({ visibility: 'public', readonly: true });
    expect(area).toMatchObject({ kind: 'MethodDeclaration', abstract: true, body: null });

    const members = first(
      'class A {\n    get() number { return 1 }\n    set string\n    readonly abstract = 1\n    static get x() number { return 1 }\n}',
      'ClassDeclaration',
    ).members;

    expect(members.map((member) => member.kind === 'MethodDeclaration' && member.accessor)).toEqual(
      [undefined, false, false, 'get'],
    );
    expect(members[2]).toMatchObject({ readonly: true, name: { name: 'abstract' } });
    expect(
      parseErrors('const abstract = 1\nconst data = abstract\nfunc f(readonly number) { }'),
    ).toEqual([]);
  });

  it.each([
    [
      'class A {\n    get x(v number) number { return v }\n}',
      'a getter takes nothing and returns one value, e.g. get area() number',
    ],
    [
      'class A {\n    set x() { }\n}',
      'a setter takes one value and returns nothing, e.g. set area(v number)',
    ],
    ['class A {\n    async get x() number { return 1 }\n}', 'a getter cannot be async'],
    [
      'abstract class A {\n    abstract f() { }\n}',
      'an abstract method has no body: the subclasses implement it',
    ],
    [
      'abstract class A {\n    private abstract f()\n}',
      'an abstract method cannot be private: the subclasses that implement it could not see it',
    ],
    ['abstract class A {\n    static abstract f()\n}', 'a static method cannot be abstract'],
    [
      'abstract class A {\n    abstract x number\n}',
      'only methods can be abstract: for a field, declare an abstract getter, e.g. abstract get name() string',
    ],
    [
      'class A {\n    readonly f() { }\n}',
      'only fields can be readonly: a method cannot be assigned anyway',
    ],
    ['class A {\n    readonly readonly x number\n}', 'duplicate "readonly" modifier'],
    ['class A {\n    readonly constructor() { }\n}', 'a constructor cannot be readonly'],
    [
      'func f(private x number) { }',
      'only the parameters of a constructor can be properties, e.g. constructor(private name string)',
    ],
  ])('reports %j', (source, message) => {
    expect(parseErrors(source)).toEqual([message]);
  });
});

describe('checking', () => {
  it('accepts the members of the classes', () => {
    expect(
      errors(
        `${SHAPES}const s = new Square(2)\ns.size = 3\nconst shape Shape = s\nconsole.log(shape.name, s.perimeter, shape.describe())`,
      ),
    ).toEqual([]);
  });

  it('assigns a readonly field only in the constructor of its class', () => {
    const point =
      'class Point {\n    readonly x number\n    constructor(x number) {\n        this.x = x\n    }\n';

    expect(errors(`${point}}\nconst p = new Point(1)\nconsole.log(p.x)`)).toEqual([]);
    expect(errors(`${point}    move() {\n        this.x = 2\n    }\n}`)).toEqual([
      'cannot assign to "x": it is readonly, so only the constructor of Point assigns it',
    ]);
    expect(errors(`${point}}\nconst p = new Point(1)\np.x++`)).toEqual([
      'cannot assign to "x": it is readonly, so only the constructor of Point assigns it',
    ]);
    expect(errors(`${SHAPES}const s = new Square(1)\ns.name = "box"`)).toEqual([
      'cannot assign to "name": it is readonly, so only the constructor of Shape assigns it',
    ]);
  });

  it('reads a getter, assigns a setter, and gives both one type', () => {
    expect(errors(`${SHAPES}const s = new Square(1)\ns.perimeter = 1`)).toEqual([
      'cannot assign to "perimeter": it has a getter and no setter',
    ]);
    expect(errors('class A {\n    set x(v number) { }\n}\nconsole.log(new A().x)')).toEqual([
      'cannot read "x": it has a setter and no getter',
    ]);
    expect(
      errors('class A {\n    get x() number { return 1 }\n    set x(v string) { }\n}'),
    ).toEqual(['the getter and the setter of "x" have different types: number and string']);
    expect(errors('class A {\n    x number\n    get x() number { return 1 }\n}')).toEqual([
      'duplicate member "x"',
    ]);
    expect(errors(`${SHAPES}const n string = new Square(1).size`)).toEqual([
      'cannot use number as string',
    ]);
  });

  it('does not let a field and a getter of a base class hide each other', () => {
    expect(
      errors('class A {\n    x = 1\n}\nclass B extends A {\n    get x() number { return 2 }\n}'),
    ).toEqual([
      '"x" is a field in A, which would hide a getter or setter here: the field is set on each instance; override it with a field',
    ]);
    expect(
      errors('class A {\n    get x() number { return 2 }\n}\nclass B extends A {\n    x = 1\n}'),
    ).toEqual([
      '"x" is a getter or setter in A, which a field here would hide: override it with a getter or setter',
    ]);
  });

  it('makes no instances of an abstract class, and implements its abstract methods', () => {
    expect(errors(`${SHAPES}const s = new Shape("blob")`)).toEqual([
      'cannot create an instance of the abstract class "Shape": create one of a class that extends it',
    ]);
    expect(errors(`${SHAPES}class Blob extends Shape {\n}`)).toEqual([
      'class "Blob" does not implement Shape.area: implement it or make the class abstract, e.g. abstract class Blob',
    ]);
    expect(errors(`${SHAPES}abstract class Blob extends Shape {\n}`)).toEqual([]);
    expect(errors('class A {\n    abstract f()\n}')).toEqual([
      '"f" is abstract, so its class must be too: abstract class A',
    ]);
    expect(
      errors(
        `${SHAPES}class Cube extends Square {\n    area() number {\n        return super.area() * 6\n    }\n}\nclass Odd extends Shape {\n    area() number {\n        return super.area()\n    }\n}`,
      ),
    ).toEqual(['super.area is abstract in Shape: it has no code to run']);
  });

  it('checks the properties of constructor parameters', () => {
    expect(errors(`${SHAPES}console.log(new Square(1).side)`)).toEqual([
      '"side" is private in Square',
    ]);
    expect(errors('class A {\n    x number\n    constructor(public x number) { }\n}')).toEqual([
      'duplicate member "x"',
    ]);
    expect(errors('data class A {\n    constructor(private f func()) { }\n}')).toEqual([
      'the fields of a data class go to other threads as copies: a function cannot be copied',
    ]);
  });
});

describe('generated code', () => {
  it('writes accessors, leaves out abstract methods and assigns the parameter properties', () => {
    expect(js(SHAPES)).toBe(`class Shape {
  constructor(name) {
    this.name = name;
  }

  describe() {
    return \`\${this.name}: \${this.area()}\`;
  }
}

class Square extends Shape {
  constructor(side) {
    super("square");
    this.side = side;
  }

  area() {
    return this.side ** 2;
  }

  get size() {
    return this.side;
  }

  set size(value) {
    this.side = value;
  }

  get perimeter() {
    return this.side * 4;
  }
}
`);
  });

  it('runs', () => {
    expect(
      run(
        `${SHAPES}const s = new Square(2)\ns.size = 3\nconsole.log(s.describe(), s.size, s.perimeter)`,
      ),
    ).toEqual(['square: 9 3 12']);
  });
});
