import type * as ast from '../ast.ts';
import { ControlStatementEmitter } from './control-statements.ts';
import { ARROW } from './syntax.ts';

// `for i in 0..n` → `for (let i = 0, $$end = n; i < $$end; i++)`: a loop of JS, without an array
// of the numbers. The end is computed once, before the loop, as in Go; a number is written as it
// is. Elsewhere, as in `{for}` of markup, a range is the array of `$$numbers(0, n)`.

export abstract class RangeLoopEmitter extends ControlStatementEmitter {
  protected override forInStatement(node: ast.ForInStatement): void {
    if (node.iterable.kind !== 'RangeExpression' || node.go) {
      super.forInStatement(node);

      return;
    }

    const { from, to } = node.iterable;

    this.withScope([[node.value.name, 'loop']], () => {
      const value = this.name(node.value.name);
      const start = `let ${value} = ${this.expression(from, ARROW)}`;
      const literal = to.kind === 'NumberLiteral';
      const end = literal ? to.raw : '$$end';
      const init = literal ? start : `${start}, $$end = ${this.expression(to, ARROW)}`;

      this.line(
        this.labeled(
          node,
          `for (${init}; ${value} < ${end}; ${value}++) ${this.loopBody(node.body)}`,
        ),
      );
    });
  }
}
