import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { moduleProject } from './project.ts';

// Signals and cancellation as channels (runtime/signals.js): `signal(...names)` gets the signals of
// the process until it is closed, `done(abortSignal)` gets the reason of an abort and is closed,
// and `abortSignal(ch)` aborts when the channel gets a value or is closed.

/** A module next to this file, so that AbortSignal has the types of the lib files. */
const file = join(import.meta.dirname, 'main.rk');

function errors(source: string): string[] {
  return compile(source, { filename: file }).diagnostics.map((d) => d.message);
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

describe('checking', () => {
  it('takes the names of signals', () => {
    expect(errors('const stop = signal("SIGINT", "SIGTERM")\nclose(stop)')).toEqual([]);
    expect(errors('const stop = signal()\nclose(stop)')).toEqual([
      'signal() takes the signals to listen to, e.g. signal("SIGINT", "SIGTERM")',
    ]);
    expect(errors('const stop = signal("INT")\nclose(stop)')).toEqual([
      '"INT" is not the name of a signal: they start with SIG, e.g. signal("SIGINT", "SIGTERM")',
    ]);
    expect(
      errors('const stop = signal("SIGINT")\nconst name number = <-stop\nclose(stop)'),
    ).toEqual(['cannot use string as number']);
  });

  it('takes an AbortSignal for done(), and gives one from abortSignal()', () => {
    expect(
      errors(`const controller = new AbortController()
const cancelled = done(controller.signal)
const stop = chan<string>()
const signal AbortSignal = abortSignal(stop)
const wrong number = abortSignal(stop)
const bad = done(1)
close(stop)`),
    ).toEqual([
      'cannot use AbortSignal as number',
      'done() takes an AbortSignal, such as request.signal, not number',
    ]);
  });

  it('warns of a signal that is never closed, since it keeps the program running', () => {
    const { warnings } = compile('const stop = signal("SIGTERM")\nconst name = <-stop');

    expect(warnings.map((warning) => warning.message)).toEqual([
      '"stop" is never closed, and it keeps the program running until it is: close it once the signal has come, e.g. close(stop)',
    ]);
  });
});

describe('the generated code', () => {
  it('calls the functions of Channel, unless the names are declared', () => {
    const code = js(`const stop = signal("SIGINT")
close(stop)
func wait(done chan bool) {
    close(done)
}
const controller = new AbortController()
const cancelled = done(controller.signal)
const aborts = abortSignal(cancelled)`);

    expect(code).toContain('const stop = $$Channel.signal("SIGINT");');
    expect(code).toContain('$$Channel.close(done);');
    expect(code).toContain('const cancelled = $$Channel.done(controller.signal);');
    expect(code).toContain('const aborts = $$Channel.abortSignal(cancelled);');
  });
});

describe('running', () => {
  it('gives the reason of an abort, then is closed', async () => {
    expect(
      await run(`const controller = new AbortController()
const cancelled = done(controller.signal)
setTimeout(() => controller.abort("too slow"), 5)
console.log(<-cancelled)
const again, ok = <-cancelled
console.log(again, ok)
const aborted = new AbortController()
aborted.abort("before")
console.log(<-done(aborted.signal))`),
    ).toEqual(['too slow', 'null false', 'before']);
  });

  it('aborts when the channel gets a value or is closed', async () => {
    expect(
      await run(`const quit = chan<string>(1)
const first = abortSignal(quit)
quit <- "shutdown"
await Promise.resolve()
console.log(first.aborted, first.reason)
const closed = chan<bool>()
const second = abortSignal(closed)
close(closed)
<-after(5)
console.log(second.aborted, second.reason.name)`),
    ).toEqual(['true shutdown', 'true AbortError']);
  });

  const cli = new URL('../src/cli.ts', import.meta.url).pathname;

  it('gets the signals of the process, and keeps the program running until it is closed', async () => {
    const dir = moduleProject('rook-signals-');

    writeFileSync(
      join(dir, 'main.rk'),
      `const stop = signal("SIGINT", "SIGTERM")
console.log("waiting")
console.log("got", <-stop)
close(stop)
console.log("done")
`,
    );

    expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], { cwd: dir }).status).toBe(0);

    const child = spawn(process.execPath, ['main.js'], { cwd: dir });
    let stdout = '';
    let stderr = '';

    child.stderr.on('data', (data: Buffer) => (stderr += String(data)));
    child.stdout.on('data', (data: Buffer) => {
      stdout += String(data);
      if (stdout === 'waiting\n') child.kill('SIGTERM');
    });

    const status = await new Promise((resolve) => child.on('close', resolve));

    expect(stderr).toBe('');
    expect(stdout).toBe('waiting\ngot SIGTERM\ndone\n');
    expect(status).toBe(0);
  }, 20_000);

  it('gets from rook run the signals that a process manager sends it', async () => {
    const dir = moduleProject('rook-signals-');

    writeFileSync(
      join(dir, 'main.rk'),
      'const stop = signal("SIGTERM")\nconsole.log("waiting")\nconsole.log("got", <-stop)\nclose(stop)\n',
    );

    const child = spawn(process.execPath, [cli, 'run', 'main.rk'], { cwd: dir });
    let stdout = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += String(data);
      if (stdout === 'waiting\n') child.kill('SIGTERM');
    });

    const status = await new Promise((resolve) => child.on('close', resolve));

    expect(stdout).toBe('waiting\ngot SIGTERM\n');
    expect(status).toBe(0);
  }, 20_000);
});
