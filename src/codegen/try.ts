import type * as ast from '../ast.ts';
import { isErrorType } from '../checker/error-results.ts';
import { forEachChild } from '../walk.ts';
import { startsWithObjectLiteral } from './analysis.ts';
import { DecodeEmitter } from './decode.ts';
import { ARROW, POSTFIX, UNARY } from './syntax.ts';

// `try expr`: the expression runs in a function that the runtime calls inside try/catch
// (runtime/try.js), `$$catch(() => JSON.parse(text))`. One that waits is an async function, whose
// rejected Promise is caught as well: `await $$catchAsync(async () => await fetch(url))`. The runtime
// is told how many values the expression gives, and whether the last of them is an error already.

export abstract class TryEmitter extends DecodeEmitter {
  protected override tryValue(node: ast.TryExpression): [string, number] {
    // The expression may not run to the end, so it creates no elements in advance.
    const code = this.withHoisting(false, () => this.expression(node.argument, ARROW));
    const body = startsWithObjectLiteral(node.argument) ? `(${code})` : code;
    const type = this.options.types?.get(node.argument);
    let results = '';

    if (type?.kind === 'void' || (type !== undefined && isErrorType(type))) {
      results = type.kind === 'void' ? ', 0' : ', 1, true';
    } else if (type?.kind === 'tuple') {
      results = `, ${type.types.length}${isErrorType(type.types.at(-1)!) ? ', true' : ''}`;
    }

    return waits(node.argument)
      ? [`await $$catchAsync(async () => ${body}${results})`, UNARY]
      : [`$$catch(() => ${body}${results})`, POSTFIX];
  }
}

/** Whether the expression waits, with `await` or `<-`, outside the functions in it. */
function waits(node: ast.Node): boolean {
  if (node.kind === 'UnaryExpression' && (node.operator === 'await' || node.operator === '<-')) {
    return true;
  }

  if (node.kind === 'FuncExpression' || node.kind === 'ArrowFunction') return false;

  let found = false;

  forEachChild(node, (child) => {
    found ||= waits(child);
  });

  return found;
}
