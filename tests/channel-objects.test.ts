import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { moduleProject } from './project.ts';

// `Channel` and `Topic`: the functions that channels and topics compile to, by name, and
// `Channel.EMPTY` and `Topic.EMPTY`, the zero values of their types, which are closed.

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  return code;
}

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

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

describe('the zero values', () => {
  it('makes Channel.EMPTY and Topic.EMPTY the zero values, for any type of values', () => {
    const code = js(`let c chan number
let t topic string
let q chan []number = Channel.EMPTY
const s topic ?string = Topic.EMPTY
let n chan chan number`);

    expect(code).toContain('let c = $$Channel.EMPTY;');
    expect(code).toContain('let t = $$Topic.EMPTY;');
    expect(errors('const x chan number = Topic.EMPTY')).toEqual([
      'cannot use topic any as chan number',
    ]);
  });

  it('receives the zero value of the type from them at once, and drops what is sent', async () => {
    expect(
      await run(`let c chan number
let t topic string
let q chan []number
let qs chan queue number
let cs chan chan number
const v, ok = <-c
console.log(v, ok, (<-t) == "", (<-q).length, (<-qs).length, <-cs == Channel.EMPTY)
c <- 1
t <- "x"
close(c)
close(t)
for x in c {
    console.log("never")
}
for x in t {
    console.log("never")
}
select {
case n = <-c:
    console.log("select gets", n)
}
const real = chan<number>(1)
select {
case <-real:
    console.log("never")
case s = <-t:
    console.log("topic gets", s == "")
}
console.log(stream(c) instanceof ReadableStream)`),
    ).toEqual(['0 false true 0 0 true', 'select gets 0', 'topic gets true', 'true']);
  });

  it('gives them to a goroutine, where they are closed as well', () => {
    const dir = moduleProject('rook-empty-');
    const options = { cwd: dir, encoding: 'utf8' as const, timeout: 20_000 };

    writeFileSync(
      join(dir, 'main.rk'),
      `async func first(c chan number, t topic string) (number, bool, string) {
    c <- 1
    const n, ok = <-c
    return n, ok, <-t
}
let c chan number
let t topic string
const n, ok, s = await go first(c, t)
console.log(n, ok, s == "")
`,
    );
    expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], options).stderr).toBe('');
    expect(spawnSync(process.execPath, ['main.js'], options).stdout).toBe('0 false true\n');
  });
});

describe('Channel and Topic', () => {
  it('types their functions', () => {
    expect(
      errors(`const c = Channel.make(2, 0)
const s string = c
async func f() {
    await Channel.send(c, "x")
    const n number = await Channel.receive(c)
}
const t = Topic.make("t", "")
Topic.publish(t, 1)
const l <-chan string = Topic.listen(t)`),
    ).toEqual([
      'cannot use chan number as string',
      'cannot use string as number in argument 2',
      'cannot use ?number as number: it may be null, check it first',
      'cannot use number as string in argument 2',
    ]);
  });

  it('runs them, and keeps the names a program declares', async () => {
    expect(
      await run(`const c = Channel.make(2, 0)
await Channel.send(c, 5)
console.log(await Channel.receive(c), Channel.try(c, true, 6)?.length, Channel.try(c, false, null)?.[0])
Channel.close(c)
const t = Topic.make("objects", 0)
Topic.publish(t, 1)
Topic.close(t)
const ticks = Channel.tick(5)
<-ticks
Channel.close(ticks)
console.log("done")`),
    ).toEqual(['5 0 6', 'done']);
    expect(js('const Channel = 1\nconsole.log(Channel)')).toContain('console.log(Channel);');
  });
});
