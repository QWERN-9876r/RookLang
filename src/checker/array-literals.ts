import type * as ast from '../ast.ts';
import { ExpressionChecker } from './expressions.ts';
import {
  ANY,
  arrayOf,
  commonType,
  NEVER,
  nonNull,
  typeToString,
  UNKNOWN,
  type Type,
} from './types.ts';

// Array literals: the type of their elements is the expected one, or the common type of all of
// them, `[1, null]` is a `[]?number`. A literal without spreads also keeps the types of its
// elements by position, so that a call infers `K` and `V` of a tuple `[K, V]` of a `.d.ts` from
// `["a", 1]`: `new Map([["a", 1]])` is a `Map<string, number>` (types/params.ts).

export abstract class ArrayLiteralChecker extends ExpressionChecker {
  protected override checkArrayLiteral(node: ast.ArrayLiteral, expected: Type | null): Type {
    const context = expected ? nonNull(expected) : null;
    const expectedElement =
      context?.kind === 'array' ? context.element : context?.kind === 'any' ? ANY : null;
    let element: Type = expectedElement ?? NEVER;
    const positions: Type[] = [];

    for (const item of node.elements) {
      let type: Type;

      if (item.kind === 'SpreadElement') {
        const spread = this.checkValue(item.argument, expectedElement && arrayOf(expectedElement));

        if (spread.kind === 'array') type = spread.element;
        else if (spread.kind === 'any' || spread.kind === 'unknown') type = spread;
        // JS spreads any iterable: a Set, a typed array, a `[]byte`.
        else if (spread.kind === 'object' && spread.iterates) type = spread.iterates;
        else {
          this.error(
            `cannot spread ${typeToString(spread)}: it is not an array or an iterable`,
            item.argument,
          );
          type = UNKNOWN;
        }
      } else {
        type = this.checkValue(item, expectedElement);
        positions.push(type);
      }

      if (expectedElement) {
        this.expectAssignable(
          type,
          expectedElement,
          item.kind === 'SpreadElement' ? item.argument : item,
        );
      } else {
        element = commonElement(element, type);
      }
    }

    return positions.length === node.elements.length && positions.length > 0
      ? arrayOf(element, positions)
      : arrayOf(element);
  }
}

/**
 * The common type of the elements so far and the next one; of arrays with positions, by position,
 * so that `[["a", 1], ["b", "x"]]` gives a `V` of `number | string`.
 */
function commonElement(element: Type, next: Type): Type {
  const common = commonType(element, next);

  if (
    common.kind !== 'array' ||
    element.kind !== 'array' ||
    next.kind !== 'array' ||
    element.positions?.length !== next.positions?.length ||
    !element.positions
  ) {
    return common;
  }

  return arrayOf(
    common.element,
    element.positions.map((each, i) => commonType(each, next.positions![i]!)),
  );
}
