import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import type { SourceMap } from '../src/source-map.ts';
import { rook } from '../src/vite.ts';
import { markupProject, moduleProject } from './project.ts';

// Source maps (src/source-map.ts): each statement maps to where it starts in the .rk file, so that
// stack traces and debuggers show the lines of the source.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** For each line of the code, its segments: the column there and the line and column of the source, from 1. */
function decode(map: SourceMap): { column: number; line: number; sourceColumn: number }[][] {
  let line = 0;
  let sourceColumn = 0;

  return map.mappings.split(';').map((text) => {
    let column = 0;

    return text
      .split(',')
      .filter((segment) => segment !== '')
      .map((segment) => {
        const numbers: number[] = [];
        let value = 0;
        let shift = 0;

        for (const char of segment) {
          const digit = BASE64.indexOf(char);

          value += (digit & 31) << shift;
          shift += 5;
          if ((digit & 32) === 0) {
            numbers.push(value & 1 ? -(value >> 1) : value >> 1);
            value = 0;
            shift = 0;
          }
        }

        column += numbers[0]!;
        line += numbers[2]!;
        sourceColumn += numbers[3]!;

        return { column: column + 1, line: line + 1, sourceColumn: sourceColumn + 1 };
      });
  });
}

/** Where the first line of the code that contains `text` comes from: line:column of the source. */
function origin(code: string, map: SourceMap, text: string): string {
  const index = code.split('\n').findIndex((line) => line.includes(text));
  const [segment] = decode(map)[index] ?? [];

  return segment ? `${segment.line}:${segment.sourceColumn}` : 'unmapped';
}

const cli = new URL('../src/cli.ts', import.meta.url).pathname;

describe('the map of a module', () => {
  const source = `import { readFileSync } from "node:fs"

func check(n number) number {
    if n < 0 {
        throw error("negative")
    }
    return n
}

const total = [1, 2].map(n => check(n)).length
console.log(total, check(-1), readFileSync)
`;
  const { code, map, diagnostics } = compile(source, { filename: 'app.rk' });

  it('maps each statement to where it starts', () => {
    expect(diagnostics).toEqual([]);
    expect(map!.sources).toEqual(['app.rk']);
    expect(map!.sourcesContent).toEqual([source]);
    expect(origin(code, map!, 'function check')).toBe('3:1');
    expect(origin(code, map!, 'if (n < 0)')).toBe('4:5');
    expect(origin(code, map!, 'throw new Error')).toBe('5:9');
    expect(origin(code, map!, 'return n;')).toBe('7:5');
    expect(origin(code, map!, 'const total')).toBe('10:1');
  });

  it('maps a line without a statement to the one before it, and not the imports', () => {
    const lines = code.split('\n');
    const closing = lines.findIndex((line) => line === '  }');

    expect(decode(map!)[closing]).toEqual([{ column: 1, line: 5, sourceColumn: 9 }]);
    expect(origin(code, map!, 'import { readFileSync }')).toBe('unmapped');
  });

  it('leaves no marks in the code', () => {
    expect(code).not.toMatch(/[-]/);
  });
});

describe('rook build', () => {
  const program = 'func f() number {\n    return 1\n}\nconsole.log(f())\n';

  it('writes the map next to the .js, and says where it is', () => {
    const dir = markupProject('rook-map-');

    writeFileSync(join(dir, 'app.rk'), program);
    expect(
      spawnSync(process.execPath, [cli, 'build', 'app.rk', '--out-dir', 'dist'], { cwd: dir })
        .status,
    ).toBe(0);

    const map = JSON.parse(readFileSync(join(dir, 'dist', 'app.js.map'), 'utf8')) as SourceMap;

    expect(readFileSync(join(dir, 'dist', 'app.js'), 'utf8')).toMatch(
      /\n\/\/# sourceMappingURL=app\.js\.map\n$/,
    );
    expect(map.file).toBe('app.js');
    expect(map.sources).toEqual(['../app.rk']);
  });

  it('writes no map with --no-source-map', () => {
    const dir = markupProject('rook-map-');

    writeFileSync(join(dir, 'app.rk'), program);
    spawnSync(process.execPath, [cli, 'build', 'app.rk', '--no-source-map'], { cwd: dir });

    expect(existsSync(join(dir, 'app.js.map'))).toBe(false);
    expect(readFileSync(join(dir, 'app.js'), 'utf8')).not.toContain('sourceMappingURL');
  });
});

describe('rook run', () => {
  it('shows the lines of the .rk file in stack traces, of goroutines too', () => {
    const dir = moduleProject('rook-map-');

    writeFileSync(
      join(dir, 'main.rk'),
      `func work(n number) number {
    if n > 2 {
        throw error(\`too big: \${n}\`)
    }
    return n
}

try {
    await go work(5)
} catch e {
    console.log(e.stack)
}
work(3)
`,
    );

    const { stdout, stderr } = spawnSync(process.execPath, [cli, 'run', 'main.rk'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(stdout).toMatch(/main\.rk:3:9\)/);
    expect(stderr).toMatch(/main\.rk:3:9\)/);
    expect(stderr).toMatch(/main\.rk:13:1\)/);
  });
});

describe('the Vite plugin', () => {
  it('gives Vite the map of each module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rook-vite-map-'));

    writeFileSync(join(dir, 'index.html'), '<script type="module" src="./main.rk"></script>');
    writeFileSync(join(dir, 'main.rk'), 'console.log(1)\n');
    await viteBuild({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [rook()],
      build: { outDir: join(dir, 'dist'), minify: false, sourcemap: true },
    });

    const assets = join(dir, 'dist', 'assets');
    const [file] = readdirSync(assets).filter((name) => name.endsWith('.js.map'));
    const map = JSON.parse(readFileSync(join(assets, file!), 'utf8')) as SourceMap;

    expect(map.sources.some((each) => each.endsWith('main.rk'))).toBe(true);
  });
});
