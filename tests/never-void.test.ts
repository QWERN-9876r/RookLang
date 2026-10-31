import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// `never` and `void`, which come from TypeScript declarations and can be written in Rook too, and
// constants of a module that the fields of classes use.

/** Errors of a module next to this file, which sees @types/node of the repository. */
function errors(source: string): string[] {
  return compile(source, { filename: join(import.meta.dirname, 'main.rk') }).diagnostics.map(
    (d) => d.message,
  );
}

describe('never', () => {
  it('narrows after a call that never returns, as after throw', () => {
    expect(
      errors(`func port(value ?string) string {
    if value == null {
        process.exit(1)
    }
    return value
}
func fail(message string) never {
    console.error(message)
    throw error(message)
}
func host(value ?string) string {
    if value == null {
        fail("no HOST")
    }
    return value
}
func last() number {
    fail("unreachable")
}`),
    ).toEqual([]);
  });

  it('does not let a function whose result is never reach its end', () => {
    expect(errors('func bad() never {\n    console.log("x")\n}')).toEqual([
      'a function whose result is never must not reach its end: throw, or call one that never returns, e.g. process.exit(1)',
    ]);
  });
});

describe('void', () => {
  it('is the value of a Promise without one, and no result of a function', () => {
    expect(
      errors(`interface Pool {
    close() Promise<void>
    stop() void
}
async func shut(p Pool) {
    await p.close()
    p.stop()
    const done Promise<void> = new Promise(resolve => setTimeout(resolve, 10))
    const later Promise<void> = new Promise(resolve => resolve())
    await done
    await later
}
func count(p Pool) number {
    return p.stop()
}`),
    ).toEqual(['p.stop() does not return a value']);
  });
});

describe('constants of a module in the fields of a class', () => {
  it('gives a field the type of a constant with a written type or a literal value', () => {
    expect(
      errors(`const LIMIT = 5
const NAMES []string = ["a"]
const RETRIES = { count: 3, delay: 100 }
class Box {
    limit = LIMIT
    names = NAMES
    delay number = RETRIES.delay
    label string = LIMIT
}`),
    ).toEqual(['cannot use number as string']);
  });

  it('still reports a constant used at the top level before its declaration', () => {
    expect(errors('console.log(LIMIT)\nconst LIMIT = 5')).toEqual([
      '"LIMIT" is used before its declaration',
    ]);
  });
});
