import { isNullable } from './constructors.ts';
import { memberNames } from './lazy.ts';
import { STRING, type ObjectType, type Type } from './model.ts';
import { assignable } from './relations.ts';

// What types from a `.d.ts` that are gone over or indexed accept: `Iterable<T>` takes what `for`
// goes over with values that fit, an array or a Set; `{ [string]: T }` an object of fields of `T`;
// `ArrayLike<T>` an array, a string or a typed array.

/** The values that `for` gives of a type it goes over at once, or null. */
export function iteratedBy(type: Type): Type | null {
  if (type.kind === 'array') return type.element;
  if (type.kind === 'string') return STRING;

  return type.kind === 'object' ? (type.iterates ?? null) : null;
}

/**
 * Whether `source` fits `Iterable<T>` or another interface that `for` goes over: its values must
 * fit. An array or a string, which have no members here, fits one whose members may be left out;
 * an object goes on to the check of its members (null).
 */
export function iterableAssignable(
  source: Type,
  target: ObjectType,
  assuming: [Type, Type][],
): boolean | null {
  const values = iteratedBy(source);

  if (values === null || !assignable(values, target.iterates!, assuming))
    return values === null ? null : false;
  if (source.kind === 'object') return null;

  return [...memberNames(target.members)].every((name) => {
    const member = target.members.get(name);

    return !member || (!member.method && isNullable(member.type));
  });
}

/** `{ [string]: T }` accepts an object whose own index and fields are all `T`. */
export function indexAssignable(source: Type, index: Type, assuming: [Type, Type][]): boolean {
  if (source.kind !== 'object') return false;
  if (source.index && !assignable(source.index, index, assuming)) return false;

  return [...memberNames(source.members)].every((name) => {
    const member = source.members.get(name);

    return !member || member.method || assignable(member.type, index, assuming);
  });
}

/** `ArrayLike<T>` from a `.d.ts` accepts an array, a string or a typed array of `T`. */
export function numberIndexAssignable(
  source: Type,
  index: Type,
  assuming: [Type, Type][],
): boolean {
  if (source.kind === 'array') return assignable(source.element, index, assuming);
  if (source.kind === 'string') return assignable(source, index, assuming);

  return (
    source.kind === 'object' &&
    source.numberIndex !== undefined &&
    assignable(source.numberIndex, index, assuming)
  );
}
