import type * as ast from '../ast.ts';
import { StatementParser } from './statements.ts';

// if, for, switch, select, throw, try and defer.

export abstract class ControlFlowParser extends StatementParser {
  protected override parseIf(): ast.IfStatement {
    const start = this.next().start;
    const init = this.parseHeaderInit('if');
    const condition = this.parseHeaderExpression();
    const consequent = this.parseBlock();
    let alternate: ast.BlockStatement | ast.IfStatement | null = null;

    this.checkSameLine('else');
    if (this.accept('else')) {
      alternate = this.check('if') ? this.parseIf() : this.parseBlock();
    }

    return { kind: 'IfStatement', init, condition, consequent, alternate, ...this.span(start) };
  }

  protected parseHeaderExpression(): ast.Expression {
    return this.withContext({ noObjectLiteral: true }, () => this.parseExpression());
  }

  /** `const v, err = f();` before the condition of `if` or the value of `switch`. */
  private parseHeaderInit(keyword: 'if' | 'switch'): ast.VariableDeclaration | null {
    if (!this.check('const') && !this.check('let')) return null;

    const init = this.withContext({ noObjectLiteral: true }, () =>
      this.parseVariableDeclaration(this.peek().start, false),
    );

    if (this.context.inMarkup) {
      this.error(
        `the ${keyword} of markup has no initializer: declare the variable before the markup`,
        init.start,
        init.end,
      );
    }

    this.expect(';', `";" after the initializer of ${keyword}`);

    return init;
  }

  protected override parseFor(): ast.ForStatement | ast.ForInStatement {
    return this.parseForAfter(this.next().start);
  }

  /** The rest of a `for` statement that starts at `start`, after the keyword. */
  private parseForAfter(start: number): ast.ForStatement | ast.ForInStatement {
    if (this.isForInHeader()) return this.parseForIn(start);

    const [init, condition, update] = this.withContext({ noObjectLiteral: true }, () =>
      this.parseForHeader(),
    );
    const body = this.parseLoopBody();

    return { kind: 'ForStatement', init, condition, update, body, ...this.span(start) };
  }

  /** `for x in` or `for i, x in`. */
  protected isForInHeader(): boolean {
    if (!this.check('Identifier')) return false;
    if (this.peek(1).kind === 'in') return true;

    return (
      this.peek(1).kind === ',' && this.peek(2).kind === 'Identifier' && this.peek(3).kind === 'in'
    );
  }

  /** `{` (infinite loop), `cond {`, or `init; cond; update {`. */
  protected parseForHeader(): [
    ast.SimpleStatement | null,
    ast.Expression | null,
    ast.SimpleStatement | null,
  ] {
    if (this.check('{')) return [null, null, null];

    const init = this.check(';') ? null : this.parseSimpleStatement();

    if (init?.kind === 'ExpressionStatement' && this.check('{')) {
      return [null, init.expression, null];
    }

    this.expect(';', '";" or "{"');

    const condition = this.check(';') ? null : this.parseExpression();

    this.expect(';');

    const update = this.check('{') ? null : this.parseSimpleStatement();

    return [init, condition, update];
  }

  protected parseForIn(start: number, go = false): ast.ForInStatement {
    let key: ast.Identifier | null = null;
    let value = this.parseIdentifier('loop variable');

    if (this.accept(',')) {
      key = value;
      value = this.parseIdentifier('loop variable');
    }

    this.expect('in');

    const iterable = this.parseHeaderExpression();
    const withKey = this.parseWithKey(go);
    const keyed = withKey ? { withKey } : {};

    if (!go) {
      const body = this.parseLoopBody();

      return { kind: 'ForInStatement', key, value, iterable, ...keyed, body, ...this.span(start) };
    }

    // The parts run at once in workers: nothing can leave the loop but `continue`.
    const body = this.withContext(
      { inLoop: true, inBreakable: false, inGoFor: true, labels: [] },
      () => this.parseBlock(),
    );

    return {
      kind: 'ForInStatement',
      key,
      value,
      iterable,
      ...keyed,
      body,
      go,
      ...this.span(start),
    };
  }

  /**
   * `with key todo.id` after the items of a `{for}` in markup: its blocks are found again by the
   * key instead of the item. `with` and `key` are words only here, not keywords.
   */
  private parseWithKey(go: boolean): ast.Expression | null {
    if (!this.checkWord('with')) return null;

    const start = this.next().start;

    this.expectWord('key');

    const key = this.parseHeaderExpression();

    if (go || !this.context.inMarkup) {
      this.error(
        '"with key" finds again the blocks of a {for} in markup, and this loop has none: remove it',
        start,
        key.end,
      );
    }

    return key;
  }

  /** `go for i, v in items { }`: the parts of the array run as goroutines, and the loop waits. */
  protected override parseGoFor(): ast.ForStatement | ast.ForInStatement {
    const start = this.next().start;
    const keyword = this.next();

    this.requireAsync('go for', start, keyword.end);
    if (this.isForInHeader()) return this.parseForIn(start, true);
    this.error(
      '"go for" goes over an array: write "go for i, v in items { ... }"',
      start,
      keyword.end,
    );

    return this.parseForAfter(start);
  }

  protected parseLoopBody(): ast.BlockStatement {
    return this.withContext({ inLoop: true, inBreakable: true }, () => this.parseBlock());
  }

  protected override parseSwitch(): ast.SwitchStatement {
    const start = this.next().start;
    const init = this.parseHeaderInit('switch');
    const discriminant = this.check('{') ? null : this.parseHeaderExpression();

    this.expect('{');

    const cases: ast.SwitchCase[] = [];
    let hasDefault = false;

    while (!this.check('}') && !this.check('EOF')) {
      if (this.accept(';')) continue;

      const caseStart = this.peek().start;
      let tests: ast.Expression[] = [];

      if (this.accept('default')) {
        if (hasDefault) {
          this.error('multiple "default" cases in switch', caseStart, this.span(caseStart).end);
        }

        hasDefault = true;
      } else {
        this.expect('case', '"case", "default" or "}"');
        tests = this.parseExpressionList();
      }

      this.expect(':');

      const body = this.withContext({ topLevel: false, inBreakable: true }, () =>
        this.parseStatements(() => this.check('case') || this.check('default') || this.check('}')),
      );

      cases.push({ kind: 'SwitchCase', tests, body, ...this.span(caseStart) });
    }

    this.expect('}');

    return { kind: 'SwitchStatement', init, discriminant, cases, ...this.span(start) };
  }

  /** `select { case v = <-ch: ... case ch <- v: ... default: ... }`; it waits, as `await` does. */
  protected override parseSelect(): ast.SelectStatement {
    const keyword = this.next();

    this.requireAsync('select', keyword.start, keyword.end);
    this.expect('{');

    const cases: ast.SelectCase[] = [];
    let hasDefault = false;

    while (!this.check('}') && !this.check('EOF')) {
      if (this.accept(';')) continue;

      const caseStart = this.peek().start;
      let names: ast.Identifier[] = [];
      let operation: ast.SelectCase['operation'] = null;

      if (this.accept('default')) {
        if (hasDefault) {
          this.error('multiple "default" cases in select', caseStart, this.span(caseStart).end);
        }

        hasDefault = true;
      } else {
        this.expect('case', '"case", "default" or "}"');
        [names, operation] = this.parseSelectOperation();
      }

      this.expect(':');

      const body = this.withContext({ topLevel: false, inBreakable: true }, () =>
        this.parseStatements(() => this.check('case') || this.check('default') || this.check('}')),
      );

      cases.push({ kind: 'SelectCase', names, operation, body, ...this.span(caseStart) });
    }

    this.expect('}');

    return { kind: 'SelectStatement', cases, ...this.span(keyword.start) };
  }

  /** `v = <-ch`, `v, ok = <-ch`, `<-ch` or `ch <- v`; the names are new variables of the case. */
  private parseSelectOperation(): [ast.Identifier[], ast.UnaryExpression | ast.SendStatement] {
    const start = this.peek().start;
    const names: ast.Identifier[] = [];

    if (this.check('Identifier') && (this.peek(1).kind === '=' || this.peek(1).kind === ',')) {
      do names.push(this.parseIdentifier());
      while (this.accept(','));
      this.expect('=');
      if (names.length > 2) {
        this.error(
          'a receive gives at most two values: "case v, ok = <-ch:"',
          start,
          this.span(start).end,
        );
      }
    }

    const first = this.parseExpression();

    if (names.length === 0 && this.check('<-')) {
      this.next();

      const value = this.parseExpression();

      return [names, { kind: 'SendStatement', channel: first, value, ...this.span(start) }];
    }

    if (first.kind !== 'UnaryExpression' || first.operator !== '<-') {
      return this.failAt(
        'a case of select receives, "case v = <-ch:", or sends, "case ch <- v:"',
        first.start,
        first.end,
      );
    }

    return [names, first];
  }

  protected override parseThrow(): ast.ThrowStatement {
    const start = this.next().start;
    const argument = this.parseExpression();
    const statement: ast.ThrowStatement = { kind: 'ThrowStatement', argument, ...this.span(start) };

    this.endStatement();

    return statement;
  }

  protected override parseTry(): ast.TryStatement {
    const start = this.next().start;
    const block = this.parseBlock();
    let handler: ast.CatchClause | null = null;
    let finalizer: ast.BlockStatement | null = null;

    this.checkSameLine('catch');
    if (this.check('catch')) {
      const catchStart = this.next().start;

      if (this.check('(')) this.fail('write "catch e {" without parentheses');

      const param = this.check('Identifier') ? this.parseIdentifier() : null;
      const body = this.parseBlock();

      handler = { kind: 'CatchClause', param, body, ...this.span(catchStart) };
    }

    this.checkSameLine('finally');
    if (this.accept('finally')) finalizer = this.parseBlock();

    if (handler === null && finalizer === null) {
      this.error('"try" needs a "catch" or "finally" block', start, block.start);
    }

    return { kind: 'TryStatement', block, handler, finalizer, ...this.span(start) };
  }

  protected override parseDefer(): ast.DeferStatement {
    const start = this.next().start;

    if (!this.context.inFunction) {
      this.error('"defer" outside of a function', start, this.span(start).end);
    } else if (this.context.inGoFor) {
      this.error(
        '"defer" cannot be used in the body of "go for": it runs in workers, apart from the function; defer it before the loop',
        start,
        this.span(start).end,
      );
    }

    if (this.check('{')) {
      const body = this.withContext(
        { inDefer: true, inAsync: false, inLoop: false, inBreakable: false, labels: [] },
        () => this.parseBlock(),
      );

      return { kind: 'DeferStatement', body, ...this.span(start) };
    }

    const call = this.withContext({ inDefer: true, inAsync: false }, () => this.parseExpression());

    if (call.kind !== 'CallExpression') {
      this.failAt('"defer" needs a function call or a block', call.start, call.end);
    }

    const statement: ast.DeferStatement = {
      kind: 'DeferStatement',
      body: call,
      ...this.span(start),
    };

    this.endStatement();

    return statement;
  }
}
