import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../src/build.ts';
import { compile } from '../src/index.ts';
import { errors as syntaxErrors, expr, first, sx, ty } from './parser-helpers.ts';
import { moduleProject } from './project.ts';

// Topics: `topic T`, `topic<T>(name)`, `t <- v` that waits for nobody, `<-t`, `for v in t` and
// `close(t)`, over a BroadcastChannel. Another tab is a BroadcastChannel of the same name that the
// program makes itself: in one thread it is another object, so they hear each other.

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  return code;
}

/** Runs a program in the main thread only; returns what it printed. */
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

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

/** Builds a program with `rook build` and runs it with Node, with workers. */
function runBuilt(source: string): { stdout: string; stderr: string; status: number | null } {
  const dir = moduleProject('rook-topic-');
  const options = { cwd: dir, encoding: 'utf8' as const, timeout: 20_000 };

  writeFileSync(join(dir, 'main.rk'), source);
  // Warnings, such as of channels that are never closed, do not stop the build.
  expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], options).stderr).not.toContain(
    'error:',
  );

  return spawnSync(process.execPath, ['main.js'], options);
}

/** A tab of the same site: a BroadcastChannel that prints what it hears, and `send` to the program. */
const TAB = `const tab = new BroadcastChannel(NAME)
tab.addEventListener("message", (e any) => { console.log("tab heard", JSON.stringify(e.data)) })
func send(value any) {
    tab.postMessage(value)
}
`;

const tab = (name: string) => TAB.replace('NAME', JSON.stringify(name));

describe('parsing', () => {
  it('reads topic types, making topics, and keeps topic a name elsewhere', () => {
    const declaration = first(
      'let t topic []number = topic<[]number>("numbers")',
      'VariableDeclaration',
    );

    expect(ty(declaration.type!)).toBe('topic []number');
    expect(sx(declaration.values[0]!)).toBe('(topic []number "numbers")');
    expect(sx(expr('topic < n'))).toBe('(< topic n)');
    expect(sx(expr('topic.length'))).toBe('(. topic length)');
    expect(syntaxErrors('func f(t topic string) { t <- "hi" }')).toEqual([]);
  });

  it.each([
    ['const t = topic<number>()', 'a topic takes its name, the same in every tab'],
    ['const t = topic<number>("a", "b")', '")": a topic takes only its name'],
  ])('reports %j', (source, message) => {
    expect(syntaxErrors(source)).toEqual([expect.stringContaining(message)]);
  });
});

describe('types', () => {
  it('types receiving: the zero value after close, or null where the type has none', () => {
    expect(
      errors(`interface Point { x, y number }
const numbers = topic<number>("numbers")
const points = topic<Point>("points")
async func f() {
    const n number = <-numbers
    const p Point = <-points
    const q ?Point = <-points
    const m, ok = <-numbers
    const b bool = ok
    for v in numbers {
        const s string = v
    }
}`),
    ).toEqual([
      'cannot use ?Point as Point: it may be null, check it first',
      'cannot use number as string',
    ]);
  });

  it('sends anywhere, since a send waits for nobody, and receives where "await" is', () => {
    expect(
      errors(`const t = topic<string>("t")
func send() {
    t <- "hi"
    t <- 1
}
const ch = chan<string>(1)
func f() {
    ch <- "hi"
    for v in t {}
}
async func g() {
    defer { ch <- "bye" }
}`),
    ).toEqual([
      'cannot use number as string',
      expect.stringContaining('"<-" is allowed only in async functions'),
      expect.stringContaining('"for ... in" a topic waits for its values'),
      expect.stringContaining('"<-" is not allowed inside "defer"'),
    ]);
    expect(syntaxErrors('func f(t topic number) { <-t }')).toEqual([
      expect.stringContaining('"<-" is allowed only in async functions'),
    ]);
  });

  it('keeps the type of the values exactly, and has Topic.EMPTY as its zero value', () => {
    expect(
      errors(`const a topic number = topic<number>("a")
const b topic ?number = a
const c chan number = a
let d topic number
let d2 topic string = Topic.EMPTY
let e ?topic number
const f = topic<number>(1)
close(a)
close(e)
let g topic<number> = a`),
    ).toEqual([
      'cannot use topic number as topic ?number',
      'cannot use topic number as chan number',
      'cannot use number as string',
      expect.stringContaining('cannot use ?topic number as chan any | topic any'),
      expect.stringContaining('a topic type is written with the type of its values after it'),
    ]);
  });

  it('takes only values that another tab can get', () => {
    expect(
      errors(`class Box { size number }
const a = topic<func()>("a")
const b = topic<Box>("b")
const c = topic<{ reply chan string }>("c")
const d = topic<{ items queue number; when Date; inner topic string }>("d")`),
    ).toEqual([
      'the values of a topic go to other tabs as copies: a function cannot be copied',
      'the values of a topic go to other tabs as copies: a copy of Box would lose its class and methods',
      'the values of a topic go to other tabs as copies: chan string cannot go to another tab: a channel works only within one',
    ]);
  });

  it('reports a send to a topic in select, and await of a topic', () => {
    expect(
      errors(`const t = topic<number>("t")
const ch = chan<number>(1)
select {
case t <- 1:
case v = <-t:
case <-ch:
}
await t
for i, v in t {}`),
    ).toEqual([
      expect.stringContaining(
        'a send to a topic waits for nobody, so it is not a case of "select"',
      ),
      expect.stringContaining('"await" does not wait for a topic'),
      'a topic has no keys: write "for value in t"',
    ]);
  });
});

describe('code', () => {
  it('compiles making, sending, receiving and closing', () => {
    const code = js(`const t = topic<number>("n")
func send() {
    t <- 1
}
const v, ok = <-t
for x in t {}
select {
case y = <-t:
}
close(t)`);

    expect(code).toContain('const t = $$Topic.make("n", 0);');
    expect(code).toContain('$$Topic.publish(t, 1);');
    expect(code).toContain('const [v, ok] = await $$Channel.receive($$Topic.listen(t), true, 0);');
    expect(code).toContain('for await (const x of $$Channel.range($$Topic.listen(t)))');
    expect(code).toContain('$$Channel.select([{ channel: $$Topic.listen(t), zero: 0 }], false)');
    expect(code).toContain('$$Topic.close(t);');
  });

  it('describes a topic in .d.ts by its name', () => {
    const dir = moduleProject('rook-topic-dts-');

    writeFileSync(join(dir, 'cart.rk'), 'export func listen(t topic number) {}\n');

    const { outputs, errors: failures } = build([join(dir, 'cart.rk')]);

    expect(failures).toEqual([]);
    expect(outputs[0]!.declarations!.code).toContain(
      'export declare function listen(t: { readonly $$topic: string }): void;',
    );
  });
});

describe('running', () => {
  it('gets what other tabs send, not what it sends itself', async () => {
    expect(
      await run(`${tab('run-own')}
const cart = topic<{ kind string }>("run-own")

async func watch() {
    for e in cart {
        console.log("got", e.kind)
    }
    console.log("closed")
}

watch()
cart <- { kind: "mine" }
send({ kind: "theirs" })
<-after(30)
close(cart)
<-after(10)
tab.close()`),
    ).toEqual(['tab heard {"kind":"mine"}', 'got theirs', 'closed']);
  });

  it('gives each topic of the name its own copy, and listens from the first receive on', async () => {
    expect(
      await run(`${tab('run-copies')}
interface Event { items queue number }
const a = topic<Event>("run-copies")
const b = topic<Event>("run-copies")

async func watch(t topic Event, label string) {
    for e in t {
        e.items.push(label.length)
        console.log(label, [...e.items].join(","))
    }
}

send({ items: queue<number>([0]) })
<-after(20)
watch(a, "a")
watch(b, "bb")
send({ items: queue<number>([1]) })
<-after(30)
close(a)
close(b)
tab.close()`),
    ).toEqual(['a 1,1', 'bb 1,2']);
  });

  it('gives the zero value after close, and fails a send to a closed topic', async () => {
    expect(
      await run(`const t = topic<number>("run-closed")
close(t)
const v, ok = <-t
console.log(v, ok)
try {
    t <- 1
} catch e {
    console.log(e.message)
}
try {
    close(t)
} catch e {
    console.log(e.message)
}`),
    ).toEqual(['0 false', 'send on a closed topic', 'close of a closed topic']);
  });

  it('hears goroutines, and keeps Node running only while it listens', () => {
    const { stdout, status } = runBuilt(`const progress = topic<number>("progress")

func work(t topic number, n number) number {
    for let i = 1; i <= n; i++ {
        t <- i
    }
    return n
}

async func show() {
    for p in progress {
        console.log("progress", p)
    }
}

show()
console.log("done", await go work(progress, 3))
<-after(100)
close(progress)
topic<number>("sent") <- 1
`);

    expect(stdout).toBe('progress 1\nprogress 2\nprogress 3\ndone 3\n');
    expect(status).toBe(0);
  });
});
