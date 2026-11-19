import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build.ts';

// The block "Write Rook. Ship JavaScript" of the home page turns a piece of Rook into its
// JavaScript word by word (site/src/home/words.rk). Which words stay, leave and come is a pure
// function of the two pieces of code, compiled and run here.

interface Word {
  text: string;
  line: number;
  col: number;
  kind: string;
}

interface Piece {
  text: string;
  rook: Word | null;
  js: Word | null;
}

interface Words {
  wordsOf(code: string): Word[];
  piecesOf(rook: string, js: string): Piece[];
}

let words: Words;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'rook-home-'));
  const source = new URL('../site/src/home/words.rk', import.meta.url).pathname;
  const result = build([source], { outDir });

  expect(result.errors.flatMap((error) => error.diagnostics)).toEqual([]);

  for (const { output, code, maps = [] } of result.outputs) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, code);
    for (const map of maps) writeFileSync(map.output, map.code);
  }

  words = (await import(
    result.outputs.find((each) => each.output.endsWith('words.js'))!.output
  )) as Words;
});

const ROOK = `func fib(n number) number {
    return n < 2 ? n : fib(n - 1) + fib(n - 2)
}

const both = await Promise.all([go fib(40), go fib(41)])`;

const JS = `function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// fib runs in a worker
const both = await Promise.all([$$go("fib", [40]), $$go("fib", [41])]);`;

describe('the words of the home page', () => {
  it('splits code into words with their places and kinds', () => {
    expect(words.wordsOf('const n = await go fib(40) // slow')).toEqual([
      { text: 'const', line: 0, col: 0, kind: 'kw' },
      { text: 'n', line: 0, col: 6, kind: '' },
      { text: '=', line: 0, col: 8, kind: '' },
      { text: 'await', line: 0, col: 10, kind: 'kw' },
      { text: 'go', line: 0, col: 16, kind: 'kw' },
      { text: 'fib', line: 0, col: 19, kind: 'fn' },
      { text: '(', line: 0, col: 22, kind: '' },
      { text: '40', line: 0, col: 23, kind: 'num' },
      { text: ')', line: 0, col: 25, kind: '' },
      { text: '// slow', line: 0, col: 27, kind: 'com' },
    ]);
    // The words of a string are words of their own, in the colour of a string.
    expect(words.wordsOf('f("a b")').map((word) => [word.text, word.kind])).toEqual([
      ['f', 'fn'],
      ['(', ''],
      ['"', 'str'],
      ['a', 'str'],
      ['b', 'str'],
      ['"', 'str'],
      [')', ''],
    ]);
  });

  it('keeps the words that both languages have and gives each of the others one place', () => {
    const pieces = words.piecesOf(ROOK, JS);
    const texts = (kept: (piece: Piece) => boolean) =>
      pieces.filter(kept).map((piece) => piece.text);

    // Every word of each language is on the screen once, in its order.
    expect(pieces.filter((piece) => piece.rook !== null).map((piece) => piece.rook)).toEqual(
      words.wordsOf(ROOK),
    );
    expect(pieces.filter((piece) => piece.js !== null).map((piece) => piece.js)).toEqual(
      words.wordsOf(JS),
    );

    // Only Rook has the types and `go`; only JavaScript has `$$go`, the semicolons and the comment.
    // A name is kept rather than a bracket: `fib` of `go fib(40)` stays, and its `(` leaves.
    expect(texts((piece) => piece.js === null)).toEqual([
      'func',
      'number',
      'number',
      'go',
      '(',
      'go',
      '(',
    ]);
    expect(texts((piece) => piece.rook === null)).toContain('// fib runs in a worker');
    expect(texts((piece) => piece.rook === null).filter((text) => text === '$$go')).toHaveLength(2);

    // The body of the function is the same in both: all its words stay.
    const body = pieces.filter((piece) => piece.rook?.line === 1);

    expect(body.every((piece) => piece.js?.line === 1)).toBe(true);
    // The name of the function goes into the string of the call: `go fib(40)` → `$$go("fib", [40])`.
    expect(
      pieces.filter((piece) => piece.text === 'fib' && piece.rook?.line === 4)[0]!.js,
    ).toMatchObject({ line: 5, kind: 'str' });
  });
});
