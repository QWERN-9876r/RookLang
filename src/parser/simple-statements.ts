import type * as ast from '../ast.ts';
import { ParserBase } from './base.ts';
import { cannotWait, isAssignmentOperator, describe, plural } from './syntax.ts';

// Simple statements, which `for` headers allow too: declarations of variables, assignments, `i++`
// and calls.

export abstract class SimpleStatementParser extends ParserBase {
  /** `await`, `<-ch` and `select` wait: only in async functions and at the top level. */
  protected requireAsync(what: string, start: number, end: number): void {
    if (this.context.inAsync) return;
    this.error(cannotWait(what, this.context.inDefer), start, end);
  }

  /** `x := 1` is a common habit from Go. */
  protected rejectColonEquals(): void {
    const colon = this.peek();
    const equals = this.peek(1);

    if (colon.kind === ':' && equals.kind === '=' && equals.start === colon.end) {
      this.fail('":=" is not supported: declare variables with "let" or "const"');
    }
  }

  /** Statements allowed in `for` headers: declarations, assignments, `i++` and expressions. */
  protected parseSimpleStatement(): ast.SimpleStatement {
    const start = this.peek().start;

    // `delete` is a keyword only at the start of a statement, followed by what it removes.
    if (this.checkWord('delete') && ['Identifier', 'this'].includes(this.peek(1).kind)) {
      return this.parseDelete();
    }

    if (this.check('let') || this.check('const'))
      return this.parseVariableDeclaration(start, false);

    const first = this.parseExpression();

    this.rejectColonEquals();

    if (this.check(',') || isAssignmentOperator(this.peek().kind)) {
      const targets = [first];

      while (this.accept(',')) targets.push(this.parseExpression());
      this.rejectColonEquals();

      const operator = this.peek().kind;

      if (!isAssignmentOperator(operator)) {
        return this.fail(`expected "=", found ${describe(this.peek())}`);
      }

      this.next();
      if (operator !== '=' && targets.length > 1) {
        this.error(`"${operator}" works with a single variable`, start, this.span(start).end);
      }

      for (const target of targets) this.checkAssignable(target);

      const values = this.parseExpressionList();

      this.checkArity(targets.length, values, start);

      return { kind: 'AssignmentStatement', operator, targets, values, ...this.span(start) };
    }

    // `ch <- value`: the value goes into the channel. A send to a channel waits, and one to a
    // topic does not, so whether it may be here is for the checker, which knows the type.
    if (this.check('<-')) {
      const { start: from, end } = this.next();
      const value = this.parseExpression();
      const cannotWait = this.context.inAsync
        ? {}
        : { cannotWait: { inDefer: this.context.inDefer, start: from, end } };

      return { kind: 'SendStatement', channel: first, value, ...cannotWait, ...this.span(start) };
    }

    if (this.check('++') || this.check('--')) {
      const operator = this.next().kind === '++' ? '++' : '--';

      this.checkAssignable(first);

      return { kind: 'IncDecStatement', operator, target: first, ...this.span(start) };
    }

    return { kind: 'ExpressionStatement', expression: first, ...this.span(start) };
  }

  protected checkAssignable(target: ast.Expression): void {
    // Members of decorators are read-only outside them: the checker explains it.
    const assignable =
      target.kind === 'Identifier' ||
      target.kind === 'DecoratorMember' ||
      ((target.kind === 'MemberExpression' || target.kind === 'IndexExpression') &&
        !target.optional);

    if (!assignable) this.error('cannot assign to this expression', target.start, target.end);
  }

  /**
   * `a, b = 1, 2, 3`: the counts must match, unless a single call returns all the values, or
   * `await` of a call or of `go` gives them. `v, ok = <-ch` tells whether the channel is closed.
   */
  protected checkArity(targets: number, values: ast.Expression[], start: number): void {
    if (values.length === 0 || values.length === targets) return;

    const [value] = values;

    if (targets === 2 && value?.kind === 'UnaryExpression' && value.operator === '<-') return;

    const awaited =
      value?.kind === 'UnaryExpression' && value.operator === 'await' ? value.argument : value;
    const call = awaited?.kind === 'GoExpression' ? awaited.call : awaited;

    if (values.length === 1 && call?.kind === 'CallExpression') return;
    // `chunks, failed = chan(res.body)`: the channel of a stream and that of its error.
    if (values.length === 1 && value?.kind === 'StreamChanExpression') return;
    // `user, err = decode<User>(body)`: the value and the error.
    if (values.length === 1 && value?.kind === 'DecodeExpression') return;
    // `data, err = try JSON.parse(text)`: the value and the error, as from a call.
    if (values.length === 1 && value?.kind === 'TryExpression') return;
    if (values.length === 1 && value?.kind === 'ConditionalExpression') {
      this.error(
        'a conditional expression gives one value, not the results of a call: unpack them in the branches of if/else, e.g. if ok { a, err = two() } else { a, err = other() }',
        start,
        this.span(start).end,
      );

      return;
    }

    this.error(
      `assignment mismatch: ${plural(targets, 'variable')} but ${plural(values.length, 'value')}`,
      start,
      this.span(start).end,
    );
  }

  /** `delete scores[name]`: removes a field, so the target is one. */
  private parseDelete(): ast.DeleteStatement {
    const { start } = this.next();
    const target = this.parseExpression();
    const field =
      (target.kind === 'MemberExpression' || target.kind === 'IndexExpression') && !target.optional;

    if (!field) {
      this.error('delete removes a field: delete obj.key or delete obj[key]', start, target.end);
    }

    return { kind: 'DeleteStatement', target, ...this.span(start) };
  }

  protected parseExpressionList(): ast.Expression[] {
    const expressions = [this.parseExpression()];

    while (this.accept(',')) expressions.push(this.parseExpression());

    return expressions;
  }

  /** `ref input` is one name, and the markup gives its element. */
  private checkRef(names: ast.Identifier[], valued: boolean, start: number, end: number): void {
    const name = names[0]!.name;

    if (valued) {
      this.error(
        `ref "${name}" gets its element from the markup, not from a value: write ref ${name} and <div ref={${name}}>`,
        start,
        end,
      );
    } else if (names.length > 1) {
      this.error(`ref declares one name, e.g. ref ${name}`, start, end);
    }
  }

  private parseDerivedBlock(): ast.FuncExpression {
    const body = this.parseFunctionBody();

    return {
      kind: 'FuncExpression',
      params: [],
      results: [],
      body,
      start: body.start,
      end: body.end,
    };
  }

  /** `const { name, size: bytes, ...rest } = file`: fields of an object, one level deep. */
  private parseDestructuring(
    start: number,
    exported: boolean,
    keyword: 'const' | 'let',
  ): ast.VariableDeclaration {
    const names: ast.Identifier[] = [];
    const keys: (ast.Identifier | ast.StringLiteral)[] = [];
    let rest = false;

    this.expect('{');
    this.parseList('}', () => {
      if (rest) this.fail('...rest is the last name: it gets the other fields');
      if (this.accept('...')) {
        rest = true;
        names.push(this.parseIdentifier('variable name'));

        return;
      }

      const token = this.peek();
      const key = this.check('String') ? this.parseStringLiteral() : this.parsePropertyName();

      if (this.accept(':')) {
        names.push(this.parseIdentifier('variable name'));
      } else if (key.kind === 'Identifier' && token.kind === 'Identifier') {
        names.push({ ...key });
      } else {
        const shown = token.kind === 'String' ? token.text : `"${token.text}"`;

        this.fail(`${shown} needs a name to take its value, e.g. { ${token.text}: name }`);
      }

      keys.push(key);
    });
    this.expect('=', '"=" and the object: a pattern takes its fields from a value');

    const value = this.parseExpression();

    return {
      kind: 'VariableDeclaration',
      exported,
      keyword,
      isPublic: false,
      names,
      type: null,
      values: [value],
      body: null,
      pattern: { keys, rest },
      ...this.span(start),
    };
  }

  protected parseVariableDeclaration(start: number, exported: boolean): ast.VariableDeclaration {
    const token = this.next();
    const keyword =
      token.kind === 'const'
        ? 'const'
        : token.text === 'state' || token.text === 'derived' || token.text === 'ref'
          ? token.text
          : 'let';

    if (this.check('{') && (keyword === 'const' || keyword === 'let')) {
      return this.parseDestructuring(start, exported, keyword);
    }

    const names = [this.parseIdentifier('variable name')];

    while (this.accept(',')) names.push(this.parseIdentifier('variable name'));

    // `derived summary {` starts the block that computes it, as `{` after the parameters of a
    // function starts its body: an object type goes in parentheses.
    const block = () => keyword === 'derived' && this.check('{');
    const type = !block() && this.canStartType() ? this.parseType() : null;
    const body = block() ? this.parseDerivedBlock() : null;
    const values = body === null && this.accept('=') ? this.parseExpressionList() : [];
    const { end } = this.span(start);

    if (keyword === 'ref') {
      this.checkRef(names, values.length > 0, start, end);
    } else if (
      keyword === 'derived' &&
      (names.length !== 1 || values.length + Number(!!body) !== 1)
    ) {
      this.error(
        'derived is one name and the expression it is computed from, e.g. derived double = count * 2, or a block that returns it: derived total number { ... return sum }',
        start,
        end,
      );
    } else if (values.length === 0 && type === null && body === null) {
      this.error(`"${names[0]!.name}" needs a type or a value`, start, end);
    } else if (values.length === 0 && keyword === 'const') {
      this.error('constants need a value', start, end);
    }

    this.checkArity(names.length, values, start);

    return {
      kind: 'VariableDeclaration',
      exported,
      isPublic: false,
      keyword,
      names,
      type,
      values,
      body,
      start,
      end,
    };
  }
}
