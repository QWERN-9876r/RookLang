import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { runWithDom } from './fake-dom.ts';

// Parameters of functions as in JS: default values at the end, `times = 1`, and the rest of the
// arguments in an array, `...parts []any`, in functions, methods, func literals and arrows.

function errors(source: string): string[] {
  return compile(source, { runtime: 'inline' }).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics.map((d) => d.message)).toEqual([]);

  return code;
}

describe('default values', () => {
  it('let the arguments at the end be left out, and give a type when it is not written', () => {
    expect(
      runWithDom(`func greet(name string = "you", times = 2) string {
    return name.repeat(times)
}
class Box {
    constructor(private size number = 1) {}
    grow(by = 1) number {
        return this.size + by
    }
}
const f = (a number, b = 10) => a + b
console.log(greet(), greet("Ann", 1), new Box().grow(), new Box(5).grow(2), f(1), f(1, 2))`),
    ).toEqual(['youyou Ann 2 7 11 3']);
    expect(js('func greet(name string = "you") {}')).toContain('function greet(name = "you")');
  });

  it('are checked against the type, and come last', () => {
    expect(
      errors(`func a(x number = "one") {}
func b(x = 1, y number) {}
func c(x = 1) {}
c("two")`),
    ).toEqual([
      'cannot use string as number',
      '"y" comes after a parameter with a default value, so it needs one too, e.g. y = ...',
      'cannot use string as number in argument 1',
    ]);
  });
});

describe('rest parameters', () => {
  it('take the arguments after the others in an array', () => {
    expect(
      runWithDom(`func log(level string, ...parts []any) {
    console.log(level, parts.length, ...parts)
}
interface Sink {
    write(...lines []string) number
}
const sink Sink = { write: (...lines) => lines.length }
const sum func(...[]number) number = (...ns) => ns.reduce((a, b) => a + b, 0)
const numbers = [1, 2]
log("info", "a", 1)
log("none")
console.log(sink.write("x", "y"), sum(...numbers, 3))`),
    ).toEqual(['info 2 a 1', 'none 0', '2 6']);
    expect(js('func log(...parts []any) {}')).toContain('function log(...parts)');
  });

  it('check each argument, and need an array type', () => {
    expect(
      errors(`func sum(...ns []number) number {
    return ns.length
}
sum(1, "2")
func bad(...ns number) {}`),
    ).toEqual([
      'cannot use string as number in argument 2',
      '...ns takes the arguments in an array: write its type as one, e.g. ...ns []number',
    ]);
    expect(errors('func last(...ns []number, x number) {}')).toEqual([
      '...ns is the last parameter',
    ]);
  });
});
