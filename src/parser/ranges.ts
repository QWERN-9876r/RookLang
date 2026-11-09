import type * as ast from '../ast.ts';
import { ControlFlowParser } from './control-flow.ts';

// Ranges after `in` of a `for`, `for i in 0..n`: the numbers from 0 up to n, without n. A range is
// written only there, so it is not an expression of its own elsewhere.

export abstract class RangeParser extends ControlFlowParser {
  protected override parseRange(
    from: ast.Expression,
    key: ast.Identifier | null,
    go: boolean,
  ): ast.Expression {
    if (!this.check('..')) return from;

    const dots = this.next();
    const to = this.parseHeaderExpression();

    if (key) {
      this.error(
        `a range gives one value, the number: write "for ${key.name} in ..."`,
        key.start,
        key.end,
      );
    }

    if (go) {
      this.error(
        '"go for" goes over an array: write the loop without go, or "go for i, v in items"',
        dots.start,
        dots.end,
      );
    }

    return { kind: 'RangeExpression', from, to, start: from.start, end: to.end };
  }
}
