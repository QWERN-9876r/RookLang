import type * as ast from '../ast.ts';
import { ControlFlowParser } from './control-flow.ts';
import type { Label } from './syntax.ts';

// The statements that jump, `return`, `break` and `continue`, and the labels that `break` and
// `continue` name: `outer: for ... { for ... { continue outer } }`.

export abstract class JumpParser extends ControlFlowParser {
  /** `outer: for`, `outer: switch` or `outer: select`: the statements that break can leave. */
  protected override parseLabeled(): ast.Statement {
    const label = this.parseIdentifier('label');

    this.expect(':');

    const goFor = this.check('go') && this.peek(1).kind === 'for';
    const loop = this.check('for');

    if (goFor || (!loop && !this.check('switch') && !this.checkWord('select'))) {
      this.error(
        goFor
          ? '"go for" cannot have a label: its parts run at once in workers, which break and continue cannot leave'
          : 'a label goes before for, switch or select: only they can be left with break, e.g. outer: for ...',
        label.start,
        label.end,
      );

      return this.parseStatement();
    }

    if (this.context.labels.some((each) => each.name === label.name)) {
      this.error(
        `label "${label.name}" is already used by an enclosing statement`,
        label.start,
        label.end,
      );
    }

    const entry: Label = { name: label.name, loop, used: false };
    const statement = this.withContext({ labels: [...this.context.labels, entry] }, () =>
      this.parseStatement(),
    ) as ast.LabeledStatement;

    if (!entry.used) {
      this.error(
        `label "${label.name}" is not used: leave the statement with "break ${label.name}" or remove the label`,
        label.start,
        label.end,
      );
    }

    return { ...statement, label, start: label.start };
  }

  protected override parseReturn(): ast.ReturnStatement {
    const start = this.next().start;

    if (this.context.inGoFor) {
      this.error(
        '"return" cannot leave "go for": its body runs in workers; skip an element with "continue"',
        start,
        this.span(start).end,
      );
    } else if (!this.context.inFunction) {
      this.error('"return" outside of a function', start, this.span(start).end);
    } else if (this.context.inDefer) {
      this.error('"return" is not allowed inside "defer"', start, this.span(start).end);
    }

    const values =
      this.check(';') || this.check('}') || this.check('EOF') ? [] : this.parseExpressionList();
    const statement: ast.ReturnStatement = { kind: 'ReturnStatement', values, ...this.span(start) };

    this.endStatement();

    return statement;
  }

  /** `}` + newline + `else`: the newline ends the `if`, so explain the error instead of failing. */
  protected override parseBreakOrContinue(): ast.BreakStatement | ast.ContinueStatement {
    const token = this.next();
    const word = token.kind === 'break' ? 'break' : 'continue';
    const label = this.check('Identifier') ? this.parseIdentifier('label') : null;
    const span = { start: token.start, end: label?.end ?? token.end };

    if (label) this.checkLabel(word, label);
    else if (word === 'continue' && !this.context.inLoop) {
      this.error('"continue" outside of a loop', token.start, token.end);
    } else if (word === 'break' && !this.context.inBreakable) {
      this.error(
        this.context.inGoFor
          ? '"break" cannot stop "go for": its parts run at once in workers; skip an element with "continue"'
          : '"break" outside of a loop or switch',
        token.start,
        token.end,
      );
    }

    this.endStatement();

    const kind = word === 'break' ? 'BreakStatement' : 'ContinueStatement';

    return { kind, ...(label ? { label } : {}), ...span };
  }

  /** `break outer` leaves an enclosing statement with that label; `continue outer`, a loop. */
  private checkLabel(word: 'break' | 'continue', label: ast.Identifier): void {
    const entry = this.context.labels.findLast((each) => each.name === label.name);

    if (!entry) {
      this.error(
        this.context.inGoFor
          ? `"${word} ${label.name}" cannot leave "go for": its parts run at once in workers`
          : `label "${label.name}" is not defined: put it before an enclosing loop, e.g. ${label.name}: for ...`,
        label.start,
        label.end,
      );

      return;
    }

    entry.used = true;
    if (word === 'continue' && !entry.loop) {
      this.error(
        `"continue ${label.name}" needs a loop, and ${label.name} labels a switch or select: leave it with "break ${label.name}"`,
        label.start,
        label.end,
      );
    }
  }
}
