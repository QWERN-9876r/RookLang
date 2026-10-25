import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleProject } from './project.ts';

// `rook run --watch`: a change of a file that the program compiled or read stops it and runs it
// again (src/run-file.ts); Ctrl+C ends the watching.

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

/** Runs `rook run --watch main.rk`; `until(text)` waits for the output to contain the text. */
function watch(dir: string) {
  const child = spawn(process.execPath, [cli, 'run', '--watch', 'main.rk'], { cwd: dir });
  let output = '';
  const waiting: [string, () => void][] = [];
  const update = (data: Buffer) => {
    output += String(data);
    for (const [text, done] of waiting.splice(0)) {
      if (output.includes(text)) done();
      else waiting.push([text, done]);
    }
  };

  child.stdout.on('data', update);
  child.stderr.on('data', update);

  return {
    child,
    output: () => output,
    until: (text: string) =>
      new Promise<void>((resolve) => {
        if (output.includes(text)) resolve();
        else waiting.push([text, resolve]);
      }),
    closed: new Promise<number | null>((resolve) => child.on('close', resolve)),
  };
}

describe('rook run --watch', () => {
  it('runs again when the program or a module it imports changes', async () => {
    const dir = moduleProject('rook-watch-');

    writeFileSync(join(dir, 'lib.rk'), 'export const N = 1\n');
    writeFileSync(join(dir, 'main.rk'), 'import { N } from "./lib.rk"\nconsole.log("value", N)\n');

    const run = watch(dir);

    await run.until('value 1\nrook: waiting for a change to run again\n');
    writeFileSync(join(dir, 'lib.rk'), 'export const N = 2\n');
    await run.until('value 2\n');
    writeFileSync(
      join(dir, 'main.rk'),
      'import { N } from "./lib.rk"\nconsole.log("value", N * 10)\n',
    );
    await run.until('value 20\n');
    run.child.kill('SIGINT');

    expect(await run.closed).toBe(0);
    expect(run.output()).toContain('rook: lib.rk changed, running again\nvalue 2\n');
  }, 30_000);

  it('stops a program that runs, and waits for a change after a compile error', async () => {
    const dir = moduleProject('rook-watch-');

    writeFileSync(
      join(dir, 'main.rk'),
      'const ticks = tick(50)\nconsole.log("started")\nfor t in ticks {\n}\n',
    );

    const run = watch(dir);

    await run.until('started\n');
    writeFileSync(join(dir, 'main.rk'), 'let = 1\n');
    await run.until('error: expected variable name');
    await run.until('rook: waiting for a change to run again\n');
    writeFileSync(join(dir, 'main.rk'), 'console.log("fixed")\n');
    await run.until('fixed\n');
    run.child.kill('SIGINT');

    expect(await run.closed).toBe(0);
  }, 30_000);
});
