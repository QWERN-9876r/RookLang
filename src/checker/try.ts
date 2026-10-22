import type * as ast from '../ast.ts';
import { DecodeChecker } from './decode.ts';
import { isErrorType } from './error-results.ts';
import { ERROR, type Type } from './types.ts';

// `try expr`: an exception in the expression, or a rejected Promise that an `await` in it waits
// for, becomes an error, as if the expression returned it (codegen/try.ts): `try JSON.parse(text)`
// gives `(any, error)`, `try save()` of a function without results gives the error alone, and of
// `(User, error)` the exception is one more way to get that error.

export abstract class TryChecker extends DecodeChecker {
  protected override checkTryExpression(node: ast.TryExpression): Type {
    const type = this.checkExpression(node.argument, null);

    if (type.kind === 'void' || isErrorType(type)) return ERROR;
    if (type.kind !== 'tuple') return { kind: 'tuple', types: [type, ERROR] };

    return isErrorType(type.types.at(-1)!)
      ? type
      : { kind: 'tuple', types: [...type.types, ERROR] };
  }
}
