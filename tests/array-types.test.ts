import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { errors as syntaxErrors, first, member, sx, expr, ty } from './parser-helpers.ts';

// Array types are written after the type of the elements, as in TypeScript: `string[]`. `[]`
// belongs to the type just before it, so `?string[]` is an array or null and `(?string)[]` an array
// of nullable strings (docs/spec.md, "Types").

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

describe('array types', () => {
  it.each([
    ['type A string[]', 'ArrayType', 'string[]'],
    ['type A ?string[]', 'NullableType', '?string[]'],
    ['type A (?string)[]', 'ArrayType', '(?string)[]'],
    ['type A ?(?string)[]', 'NullableType', '?(?string)[]'],
    ['type A number[][]', 'ArrayType', 'number[][]'],
    ['type A Map<string, number[]>[]', 'ArrayType', 'Map[]'],
    ['type A { x number }[]', 'ArrayType', '{ x number }[]'],
    ['type A (string | number)[]', 'ArrayType', '(string | number)[]'],
    ['type A string | number[]', 'UnionType', '(string | number[])'],
    ['type A func() number[]', 'FuncType', 'func() number[]'],
    ['type A (func() number)[]', 'ArrayType', '(func() number)[]'],
    ['type A (() => void)[]', 'ArrayType', '(func())[]'],
    ['type A chan string[]', 'ChanType', 'chan string[]'],
    ['type A queue string[]', 'QueueType', 'queue string[]'],
    ['type A "a"[]', 'ArrayType', '"a"[]'],
  ])('%s', (source, kind, written) => {
    const { type } = first(source, 'TypeAliasDeclaration');

    expect(type.kind).toBe(kind);
    expect(ty(type)).toBe(written);
  });

  it('reads a field of an array of functions, not a method', () => {
    expect(
      first(
        'interface Owner {\n  cleanups (func())[]\n  run() number[]\n}',
        'InterfaceDeclaration',
      ).members.map(member),
    ).toEqual(['cleanups (func())[]', 'run() number[]']);
    expect(errors('class Owner {\n  cleanups (func())[] = []\n  run() {}\n}')).toEqual([]);
  });

  it('reads the conversion to bytes and make of a typed array', () => {
    expect(sx(expr('byte[]("rook")'))).toBe('(byte[] "rook")');
    expect(sx(expr('make(float64[], n)'))).toBe('(make float64[] n)');
    expect(sx(expr('make(File[])'))).toBe('(make File[])');
    expect(sx(expr('xs[i]'))).toBe('([] xs i)');
  });

  it('leaves an array literal on the next line alone', () => {
    expect(errors('let xs number[]\n[1, 2].forEach(x => console.log(x))')).toEqual([]);
  });

  it('says how to write the array types of Go', () => {
    const expected =
      'array types are written after the type of the elements, e.g. string[], not []string';

    expect(syntaxErrors('let xs []string = []')).toEqual([expected]);
    expect(syntaxErrors('const data = []byte("rook")')).toEqual([expected]);
    expect(syntaxErrors('const xs = make([]float64, 2)')).toEqual([expected]);
  });

  it('writes array types in messages as they are written in code', () => {
    expect(
      errors(`let a ?string[] = null
let b (?string)[] = [null]
let c (func() number)[] = []
let d (string | number)[] = []
let x number = a
let y number = b
let z number = c
let w number = d`),
    ).toEqual([
      'cannot use ?string[] as number',
      'cannot use (?string)[] as number',
      'cannot use (func() number)[] as number',
      'cannot use (string | number)[] as number',
    ]);
  });
});
