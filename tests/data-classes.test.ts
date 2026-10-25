import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { first } from './parser-helpers.ts';
import { moduleProject } from './project.ts';

// `data class Point`: its fields are data, and its instances go to goroutines and back, and
// through channels, with their class (runtime/classes.js), which the module registers.

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

const POINT = `data class Point {
    x, y number

    constructor(x, y number) {
        this.x = x
        this.y = y
    }

    length() number {
        return Math.hypot(this.x, this.y)
    }
}
`;

describe('parsing', () => {
  it('reads data before class, and keeps data a name elsewhere', () => {
    expect(first('data class Point {\n}', 'ClassDeclaration').data).toBe(true);
    expect(first('export data class Point {\n}', 'ClassDeclaration').exported).toBe(true);
    expect(first('class Point {\n}', 'ClassDeclaration').data).toBe(false);
    expect(errors('const data = 1\nfunc f(data number) number {\n    return data\n}')).toEqual([]);
  });
});

describe('checking', () => {
  it('lets the instances of a data class go to goroutines, and not of other classes', () => {
    expect(
      errors(
        `${POINT}\nfunc f(p Point) number {\n    return p.length()\n}\nconst n = await go f(new Point(3, 4))`,
      ),
    ).toEqual([]);
    expect(
      errors(
        'class Plain {\n    x number\n}\nfunc f(p Plain) number {\n    return p.x\n}\nconst n = await go f(new Plain())',
      ),
    ).toEqual([
      '"f" runs in a worker, which gets a copy of argument 1, but a copy of Plain would lose its class and methods: mark it to keep them, e.g. data class Plain',
    ]);
  });

  it('has fields of data, and extends only a data class', () => {
    expect(errors('data class Timer {\n    ms number\n    done ?func()\n}')).toEqual([
      'the fields of a data class go to other threads as copies: a function cannot be copied',
    ]);
    expect(errors('class Base {\n    x number\n}\ndata class Sub extends Base {\n}')).toEqual([
      'a data class extends only a data class: mark Base as one, e.g. data class Base',
    ]);
    expect(errors('data class Base {\n    x number\n}\ndata class Sub extends Base {\n}')).toEqual(
      [],
    );
  });

  it('does not go to other tabs, which may not have the class', () => {
    expect(errors(`${POINT}\nconst t = topic<Point>("points")\nclose(t)`)).toEqual([
      'the values of a topic go to other tabs as copies: Point cannot go to another tab, which may not have its class: send an object of an interface',
    ]);
  });
});

describe('the generated code', () => {
  it('registers the class with an id of its name and code', () => {
    const { code } = compile(`${POINT}\nclass Plain {\n}`);

    expect(code).toMatch(/\n}\n\$\$dataClass\(Point, "Point:[0-9a-f]{8}"\);\n/);
    expect(code).not.toContain('$$dataClass(Plain');
  });
});

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

describe('running', () => {
  it('gives the instances their class in the worker and back, through channels too', () => {
    const dir = moduleProject('rook-data-classes-');
    const options = { cwd: dir, encoding: 'utf8' as const, timeout: 20_000 };

    writeFileSync(join(dir, 'geom.rk'), `export ${POINT}`);
    writeFileSync(
      join(dir, 'main.rk'),
      `import { Point } from "./geom.rk"

data class Labeled extends Point {
    label string

    constructor(x, y number, label string) {
        super(x, y)
        this.label = label
    }
}

func far(p Point) bool {
    return p.length() > 4
}

func doubled(p Labeled) Labeled {
    return new Labeled(p.x * 2, p.y * 2, p.label + "!")
}

async func send(out chan Point) {
    out <- new Point(6, 8)
    close(out)
}

console.log(await go far(new Point(3, 4)))
const q = await go doubled(new Labeled(3, 4, "a"))
console.log(q instanceof Labeled, q.label, q.length())
const points = chan<Point>(1)
go send(points)
for p in points {
    console.log(p.length())
}
`,
    );
    expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], options).stderr).toBe('');

    const { stdout, stderr } = spawnSync(process.execPath, ['main.js'], options);

    expect(stderr).toBe('');
    expect(stdout).toBe('true\ntrue a! 10\n10\n');
  });
});
