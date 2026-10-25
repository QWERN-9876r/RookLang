import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tests of a program in Rook are written for Vitest, with the Vite plugin: Vitest runs its modules
// in Node, and a goroutine there is a worker thread, which loads the `.rk` modules with the loader
// of `rook run` (vite.ts).

const repository = new URL('..', import.meta.url).pathname;

describe('Vitest with the plugin', () => {
  it('runs the tests of .rk modules, goroutines included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rook-vitest-'));

    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(join(repository, 'node_modules', 'vitest'), join(dir, 'node_modules', 'vitest'));
    symlinkSync(join(repository, 'node_modules', 'vite'), join(dir, 'node_modules', 'vite'));
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }');
    writeFileSync(
      join(dir, 'vitest.config.ts'),
      `import { defineConfig } from 'vitest/config';
import { rook } from ${JSON.stringify(join(repository, 'src', 'vite.ts'))};

export default defineConfig({ plugins: [rook()] });
`,
    );
    writeFileSync(
      join(dir, 'math.rk'),
      `export func add(a, b number) number {
    return a + b
}

func work(n number) number {
    return n * 2
}

export async func doubled(n number) number {
    return await go work(n)
}
`,
    );
    writeFileSync(
      join(dir, 'math.test.ts'),
      `import { expect, it } from 'vitest';
import { add, doubled } from './math.rk';

it('adds', () => expect(add(1, 2)).toBe(3));
it('runs a goroutine', async () => expect(await doubled(21)).toBe(42));
`,
    );

    const vitest = join(repository, 'node_modules', 'vitest', 'vitest.mjs');
    const { stdout, status } = spawnSync(process.execPath, [vitest, 'run'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(stdout).toContain('2 passed');
    expect(status).toBe(0);
  }, 60_000);
});
