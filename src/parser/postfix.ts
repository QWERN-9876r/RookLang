import type * as ast from '../ast.ts';
import { ExpressionParser } from './expressions.ts';
import { ParseError } from './syntax.ts';

// What may follow a value besides members, indexes and calls: `user!`, which takes it not to be
// null, a template right after it, sql`select ... ${id}`, which calls it with its parts, and the
// type arguments of a call, `create<number>()`.

export abstract class PostfixParser extends ExpressionParser {
  protected override parsePostfix(expression: ast.Expression): ast.Expression {
    let result = super.parsePostfix(expression);

    while (true) {
      const token = this.peek();

      // `user!.name`: the `!` right after the value, so that `!` before a value stays a negation.
      if (token.kind === '!' && token.start === result.end) {
        this.next();
        result = {
          kind: 'NonNullExpression',
          expression: result,
          start: result.start,
          end: token.end,
        };
      } else if (token.kind === '<' && isCallee(result)) {
        // `a < b` stays a comparison: type arguments are types in `<>` with `(` right after them.
        const typeArgs = this.speculate(() => this.parseCallTypeArgs());

        if (!typeArgs) return result;

        const args = this.parseArguments();

        result = {
          kind: 'CallExpression',
          callee: result,
          typeArgs,
          arguments: args,
          optional: false,
          ...this.span(result.start),
        };
      } else if (
        (token.kind === 'Template' || token.kind === 'TemplateHead') &&
        !token.newlineBefore
      ) {
        const quasi = this.parseTemplate(token);

        result = {
          kind: 'TaggedTemplateExpression',
          tag: result,
          quasi,
          start: result.start,
          end: quasi.end,
        };
      } else {
        return result;
      }

      result = super.parsePostfix(result);
    }
  }

  /** `<number, string>` of a call, which must be followed by `(`. */
  private parseCallTypeArgs(): ast.TypeNode[] {
    this.expect('<');

    const types = [this.parseType()];

    while (this.accept(',')) types.push(this.parseType());
    this.expectTypeClose('">" after the type arguments');
    if (!this.check('(')) throw new ParseError('not a call');

    return types;
  }

  /**
   * Reads what `read` reads, or, if it fails, nothing: then it gives null, and the errors it
   * reported are dropped. Closing a type may split a `>>` token, so the tokens are restored too.
   */
  protected speculate<T>(read: () => T): T | null {
    const { pos } = this;
    const tokens = this.tokens.slice(pos);
    const reported = this.diagnostics.length;

    try {
      return read();
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      tokens.forEach((token, i) => (this.tokens[pos + i] = token));
      this.diagnostics.length = reported;
      this.pos = pos;

      return null;
    }
  }
}

/** `create` or `store.create`: what type arguments may follow. */
function isCallee(node: ast.Expression): boolean {
  return node.kind === 'Identifier' || (node.kind === 'MemberExpression' && isCallee(node.object));
}
