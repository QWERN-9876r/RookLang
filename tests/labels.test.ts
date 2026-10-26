import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as parseErrors, inFunction } from './parser-helpers.ts';

// Labels of loops, switches and selects, which `break` and `continue` name, as in Go and JS:
// `outer: for ... { for ... { continue outer } }`.

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

const GRID = `func find(grid [][]number, target number) {
    outer: for i, row in grid {
        for j, v in row {
            if v < 0 {
                continue outer
            }
            if v == target {
                console.log("found", i, j)
                break outer
            }
        }
    }
}
`;

describe('parsing', () => {
  it('puts the label on its statement, and on break and continue', () => {
    const [loop] = inFunction(
      'outer:\nfor {\n    for {\n        continue outer\n    }\n    break outer\n}',
    );

    expect(loop).toMatchObject({ kind: 'ForStatement', label: { name: 'outer' } });
    expect(loop?.kind === 'ForStatement' && loop.body.body[1]).toMatchObject({
      kind: 'BreakStatement',
      label: { name: 'outer' },
    });
    expect(parseErrors('func f() {\n    x := 1\n}')).toEqual([
      '":=" is not supported: declare variables with "let" or "const"',
    ]);
  });

  it.each([
    [
      'a: if true { }',
      'a label goes before for, switch or select: only they can be left with break, e.g. outer: for ...',
    ],
    ['a: for { }', 'label "a" is not used: leave the statement with "break a" or remove the label'],
    [
      'for { break b }',
      'label "b" is not defined: put it before an enclosing loop, e.g. b: for ...',
    ],
    [
      'a: switch {\ncase true:\n    for { continue a }\n}',
      '"continue a" needs a loop, and a labels a switch or select: leave it with "break a"',
    ],
    [
      'a: for {\n    a: for { break a }\n}',
      'label "a" is not used: leave the statement with "break a" or remove the label',
    ],
    [
      'a: for {\n    const f = func() { break a }\n}',
      'label "a" is not used: leave the statement with "break a" or remove the label',
    ],
  ])('reports %j', (body, message) => {
    expect(parseErrors(`func f() {\n${body}\n}`)).toContain(message);
  });

  it('reports a label that leaves go for', () => {
    expect(
      parseErrors(
        'async func f(xs []number) {\n    a: for {\n        go for i, x in xs {\n            break a\n        }\n        break a\n    }\n}',
      ),
    ).toEqual(['"break a" cannot leave "go for": its parts run at once in workers']);
    expect(parseErrors('async func f(xs []number) {\n    a: go for i, x in xs { }\n}')).toContain(
      '"go for" cannot have a label: its parts run at once in workers, which break and continue cannot leave',
    );
  });
});

describe('checking', () => {
  it('knows that a loop ends when a nested break leaves it', () => {
    expect(
      errors(
        'func f() number {\n    a: for {\n        for {\n            break a\n        }\n    }\n}',
      ),
    ).toEqual(['missing return at the end of the function']);
    expect(
      errors('func f() number {\n    for {\n        for {\n            break\n        }\n    }\n}'),
    ).toEqual([]);
  });
});

describe('generated code', () => {
  it('labels the loop, the switch and the select of JS', () => {
    expect(js(GRID)).toContain('outer: for (let i = 0, $$items = grid; i < $$items.length; i++) {');
    expect(js(GRID)).toContain('continue outer;');
    expect(
      js(
        'func f(x number) {\n    s: switch {\n    case x > 0:\n        for {\n            break s\n        }\n    }\n}',
      ),
    ).toContain('s: if (x > 0) {\n    while (true) {\n      break s;');
    expect(
      js(
        'func f(x number) {\n    s: switch x {\n    case 1:\n        for {\n            break s\n        }\n    }\n}',
      ),
    ).toContain('s: switch (x) {');
    expect(
      js(
        'async func f(ch chan number) {\n    s: select {\n    case v = <-ch:\n        if v > 0 {\n            break s\n        }\n    }\n}',
      ),
    ).toContain('s: {\n    const [$$case, $$received, $$ok]');
  });

  it('runs', () => {
    expect(run(`${GRID}find([[1, -1, 2], [3, 4], [5, 6]], 4)`)).toEqual(['found 1 1']);
  });
});
