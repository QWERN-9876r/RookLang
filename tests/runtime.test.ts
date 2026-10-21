import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runtimeFiles } from '../scripts/runtime-sources.ts';
import { compile as compileInBrowser } from '../src/browser.ts';
import { RUNTIME_FILES } from '../src/runtime/sources.ts';
import { compile } from '../src/index.ts';
import { moduleProject } from './project.ts';

// The runtime of compiled code, src/runtime: a module imports what it uses from
// "rooklang/runtime", or has it in it with `runtime: 'inline'`.

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

function js(source: string, runtime?: 'import' | 'inline'): string {
  const { code, diagnostics } = compile(source, { runtime });

  expect(diagnostics).toEqual([]);

  return code;
}

describe('the runtime', () => {
  it('has the code of its files in sources.ts', () => {
    expect(RUNTIME_FILES, 'src/runtime changed: `npm run format` writes sources.ts again').toEqual(
      runtimeFiles(),
    );
  });

  it('exports every name of its files from rooklang/runtime', async () => {
    // The runtime is JavaScript without declarations: its names are not typed.
    const specifier: string = 'rooklang/runtime';
    const runtime = (await import(specifier)) as Record<string, unknown>;
    const declared = Object.values(RUNTIME_FILES).flatMap((code) =>
      [...code.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\$\$\w+)/gm)].map(
        (match) => match[1]!,
      ),
    );

    expect(Object.keys(runtime).sort()).toEqual(declared.sort());
  });
});

describe('import', () => {
  it('imports the names that the code uses, with the other imports', () => {
    const code = js(`import { readFileSync } from "node:fs"
const ch = chan<number>(1)
ch <- 1
console.log(<-ch, readFileSync)`);

    expect(code.split('\n').slice(0, 3)).toEqual([
      'import { readFileSync } from "node:fs";',
      'import { $$Channel } from "rooklang/runtime";',
      '',
    ]);
  });

  it('puts one name on a line when they do not fit on one', () => {
    const code = js(`const ch = chan<number>(1)
close(ch)
const q = queue<number>()
const t = topic<number>("t")
close(t)
const data = make([]float64, 4, shared)
console.log(q, data, transfer(new Uint8Array(1)))
cancel(go func() {}())`);

    expect(code).toContain(`import {
  $$Channel,
  $$Queue,
  $$Topic,
  $$cancel,
  $$goWorker,
  $$shared,
  $$transfer,
} from "rooklang/runtime";`);
  });

  it('imports nothing for code that needs nothing', () => {
    expect(js('console.log(1 + 2)')).toBe('console.log(1 + 2);\n');
    // A member with the name of the runtime is not the runtime.
    expect(js('const x any = {}\nconsole.log(x.$chan)')).not.toContain('import');
  });

  it('keeps the start of the workers and the CSS in the module', () => {
    const { code, worker } = compile('func f() number {\n    return 1\n}\nconst n = await go f()');

    expect(code).toContain('async function $$startWorker() {');
    expect(code).toContain('import { $$goWorker } from "rooklang/runtime";');
    expect(worker).toContain('import { $$serve } from "rooklang/runtime";');
  });
});

describe('inline', () => {
  it('puts the files of the names into the module, with the files they need', () => {
    const code = js('const q = queue<number>([1])\nconsole.log(q.shift())', 'inline');

    expect(code).not.toMatch(/^(import|export) /m);
    expect(code).toContain('class $$Queue {');
    expect(code).not.toContain('function $$chan(');

    const channels = js('const ch = chan<number>(1)\nclose(ch)', 'inline');

    // A channel keeps its values in a queue, and threads.js knows its other threads.
    for (const declaration of ['function $$chan(', 'class $$Queue {', 'function $$registry() {']) {
      expect(channels).toContain(declaration);
    }
  });

  it('runs without imports, in the browser compiler too', () => {
    const { code, diagnostics } = compileInBrowser(
      'const q = queue<string>(["a"])\nq.push("b")\nconsole.log([...q].join(""))',
      null,
      { runtime: 'inline' },
    );
    const output: string[] = [];
    const log = (text: string) => output.push(text);

    expect(diagnostics).toEqual([]);

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const program = new Function('console', code) as (console: { log: typeof log }) => void;

    program({ log });
    expect(output).toEqual(['ab']);
  });
});

// Processes with workers take seconds while the other tests run too.
describe('modules', { timeout: 30_000 }, () => {
  // Before the runtime was imported, each module had its own $$Queue, and a channel of another
  // module gave all its receivers after close the same zero value.
  it('share one runtime', () => {
    const dir = moduleProject('rook-runtime-');
    const options = { cwd: dir, encoding: 'utf8' as const, timeout: 20_000 };

    writeFileSync(
      join(dir, 'a.rk'),
      'export func closed() chan queue number {\n    const c = chan<queue number>(1)\n    close(c)\n    return c\n}\n',
    );
    writeFileSync(
      join(dir, 'main.rk'),
      'import { closed } from "./a.rk"\n\nconst c = closed()\nconst first = <-c\nfirst.push(1)\nconst second = <-c\nconsole.log(second.length, first == second)\n',
    );
    expect(spawnSync(process.execPath, [cli, 'build', 'main.rk'], options).stderr).toBe('');
    expect(spawnSync(process.execPath, ['main.js'], options).stdout).toBe('0 false\n');
  });

  it('run with rook run outside a project that has rooklang', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rook-run-'));

    writeFileSync(
      join(dir, 'main.rk'),
      'func square(x number) number {\n    return x * x\n}\n\nconst q = queue<number>([await go square(3)])\nconsole.log(q.shift())\n',
    );
    expect(
      execFileSync(process.execPath, [cli, 'run', 'main.rk'], { cwd: dir, encoding: 'utf8' }),
    ).toBe('9\n');
  });
});
