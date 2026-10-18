import { ERROR, isNullable, nullable, typesEqual, type Type } from './types.ts';

// Values returned with an error: in `(User, error)` the function may return `null, err` instead of
// a User, as long as the error is not null. So where the results are unpacked, the values before
// the error may be null, and they are not null once the error is found to be null. A result that
// is nullable itself, as in `(?User, error)`, may be null without an error too.

export function isErrorType(type: Type): boolean {
  return typesEqual(type, ERROR);
}

/** Positions of the results that may be null only together with an error: all before it. */
export function guardedByError(results: readonly Type[]): number[] {
  if (results.length < 2 || !isErrorType(results.at(-1)!)) return [];

  return results.flatMap((type, i) => (i < results.length - 1 && canBeGuarded(type) ? [i] : []));
}

/** The types of the unpacked results: those before the error may be null. */
export function unpackedResults(results: readonly Type[]): Type[] {
  const guarded = guardedByError(results);

  return results.map((type, i) => (guarded.includes(i) ? nullable(type) : type));
}

function canBeGuarded(type: Type): boolean {
  switch (type.kind) {
    case 'any':
    case 'unknown':
    case 'void':
    case 'never':
    case 'null':
      return false;

    default:
      return !isNullable(type);
  }
}
