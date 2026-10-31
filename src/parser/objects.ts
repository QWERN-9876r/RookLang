import type * as ast from '../ast.ts';
import { PostfixParser } from './postfix.ts';
import { describe } from './syntax.ts';

// Object literals: `{ name: value }`, `{ name }`, `{ ...other }`, and methods written as in a
// class, `{ fetch(req Request) Response { ... } }`.

export abstract class ObjectParser extends PostfixParser {
  protected override parseObjectLiteral(): ast.ObjectLiteral {
    const start = this.expect('{').start;
    const properties = this.nested(() => this.parseList('}', () => this.parseProperty()));

    return { kind: 'ObjectLiteral', properties, ...this.span(start) };
  }

  protected parseProperty(): ast.Property | ast.SpreadElement {
    const token = this.peek();

    if (token.kind === '...') {
      this.next();

      const argument = this.parseExpression();

      return { kind: 'SpreadElement', argument, ...this.span(token.start) };
    }

    // `async load() T { ... }`: `async` before the name of a method.
    const async = token.kind === 'async' && this.peek(2).kind === '(';

    if (async) this.next();

    const key = this.check('String') ? this.parseStringLiteral() : this.parsePropertyName();

    if (this.check('(')) return this.parseObjectMethod(key, token.start, async);
    if (this.accept(':')) {
      const value = this.parseExpression();

      return { kind: 'Property', key, value, shorthand: false, ...this.span(token.start) };
    }

    // Shorthand `{ name }` means `{ name: name }`, so the key must be a plain name.
    if (key.kind !== 'Identifier' || token.kind !== 'Identifier') {
      this.fail(`expected ":" after property name, found ${describe(this.peek())}`);
    }

    return { kind: 'Property', key, value: { ...key }, shorthand: true, ...this.span(token.start) };
  }

  /** `fetch(req Request) Response { ... }`: typed parameters, as those of a `func` literal. */
  private parseObjectMethod(
    key: ast.Identifier | ast.StringLiteral,
    start: number,
    async: boolean,
  ): ast.Property {
    const funcStart = this.peek().start;
    const params = this.parseParams(false, { defaults: true, rest: 'typed' });
    const results = this.parseResults();
    const body = this.parseFunctionBody(async);
    const value: ast.FuncExpression = {
      kind: 'FuncExpression',
      ...(async ? { async } : {}),
      params,
      results,
      body,
      ...this.span(funcStart),
    };

    return { kind: 'Property', key, value, shorthand: false, method: true, ...this.span(start) };
  }
}
