import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// Callbacks given to functions of TypeScript declarations: those of lib.dom and of packages.

/** Errors of a module next to this file, which sees the packages of the repository. */
function errors(source: string): string[] {
  return compile(source, { filename: join(import.meta.dirname, 'main.rk') }).diagnostics.map(
    (d) => d.message,
  );
}

describe('a result of any or void', () => {
  it('lets a callback whose result is any or void | T end without a value', () => {
    expect(
      errors(`export func open(ws WebSocket) {
    ws.onopen = () => {
        console.log("open")
    }
    ws.addEventListener("message", e => {
        console.log(e.data)
        return
    })
}`),
    ).toEqual([]);
  });

  it('lets a function with the result any end without a value', () => {
    expect(
      errors(`func log() any {
    console.log("x")
}
func first(xs []number) ?number {
    console.log(xs)
}`),
    ).toEqual(['missing return at the end of the function']);
  });
});

describe('packages', () => {
  it('checks Vitest, whose types refer to themselves', () => {
    expect(
      errors(`import { describe, it, expect } from "vitest"

describe("x", () => {
    it("y", () => {
        expect(1).toBe(1)
    })
})`),
    ).toEqual([]);
  });

  it('prints a type inside another one as { ... } when it is long', () => {
    const [message = ''] = errors(`import { describe } from "vitest"
describe("x", 5)`);

    expect(message).toMatch(/^no overload fits these arguments/);
    expect(message.length).toBeLessThan(1000);
  });
});
