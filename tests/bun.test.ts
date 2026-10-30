import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Bun: its plugin compiles `.rk` modules when they load (src/bun.ts), in `bun app.rk`, in imports
// from TypeScript and in `bun test`, and the workers of `go` start with it too; `rook run` under
// Bun runs the program in Bun. The tests run Bun, so they are skipped where there is none.

const hasBun = spawnSync('bun', ['--version']).status === 0;
const register = fileURLToPath(new URL('../src/bun-register.ts', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const squares = `func square(n number) number {
    return n * n
}

export func squares() []number {
    return [1, 2, 3].map(square)
}

const results = await Promise.all([go square(2), go square(3)])
console.log("goroutines:", results.join(" "))
`;

/** A directory with the files, and Bun run in it: its status and output. */
function bun(files: Record<string, string>, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'rook-bun-test-'));

  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);

  const result = spawnSync('bun', args, { cwd: dir, encoding: 'utf8', timeout: 60_000 });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(!hasBun)('Bun', () => {
  it('runs a .rk module with goroutines through the plugin', () => {
    const { stdout, status } = bun({ 'app.rk': squares }, ['--preload', register, 'app.rk']);

    expect(stdout).toBe('goroutines: 4 9\n');
    expect(status).toBe(0);
  });

  it('imports .rk modules from TypeScript, in bun test too', () => {
    const files = {
      'squares.rk': squares,
      'main.ts':
        'import { squares } from "./squares.rk"\nconsole.log("ts:", squares().join(" "))\n',
      'squares.test.ts':
        'import { expect, test } from "bun:test"\nimport { squares } from "./squares.rk"\n' +
        'test("squares", () => expect(squares()).toEqual([1, 4, 9]))\n',
      'bunfig.toml': `[test]\npreload = [${JSON.stringify(register)}]\n`,
    };

    expect(bun(files, ['--preload', register, 'main.ts']).stdout).toBe(
      'goroutines: 4 9\nts: 1 4 9\n',
    );

    const tested = bun(files, ['test', 'squares.test.ts']);

    expect(tested.stderr).toContain('1 pass');
    expect(tested.status).toBe(0);
  });

  it('runs the program in Bun under rook run, with the errors of the compiler', () => {
    expect(bun({ 'app.rk': squares }, [cli, 'run', 'app.rk']).stdout).toBe('goroutines: 4 9\n');

    const failed = bun({ 'bad.rk': 'const n number = "one"\n' }, [cli, 'run', 'bad.rk']);

    expect(failed.stderr).toContain('bad.rk:1:18: error: cannot use string as number');
    expect(failed.stderr).not.toContain('    at ');
    expect(failed.status).toBe(1);
  });
});
