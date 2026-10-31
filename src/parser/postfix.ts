import type * as ast from '../ast.ts';
import { ExpressionParser } from './expressions.ts';

// What may follow a value besides members, indexes and calls: `user!`, which takes it not to be
// null, and a template right after it, sql`select ... ${id}`, which calls it with its parts.

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
}
