import { isQueue, isTopic, memberNames, typedArrayOf, typeToString, type Type } from './types.ts';

// What JSON can hold, for `decode<T>(x)` (decode.ts): numbers, strings, bool, null, literals,
// arrays, unions and objects without methods. A string is JSON text to decode.

/** Types that JSON has no way to hold, by name, with what to decode instead. */
const NOT_IN_JSON: ReadonlyMap<string, string> = new Map([
  ['Date', 'JSON has no Date: decode a string and make the Date from it, e.g. new Date(s)'],
  ['Map', 'JSON has no Map: decode an object or an array of pairs and make the Map from it'],
  ['Set', 'JSON has no Set: decode an array and make the Set from it, e.g. new Set(items)'],
  ['RegExp', 'JSON has no RegExp: decode a string and make it with new RegExp(s)'],
  ['Promise', 'a Promise cannot come from JSON'],
  ['chan', 'a channel cannot come from JSON'],
  ['chan<-', 'a channel cannot come from JSON'],
  ['<-chan', 'a channel cannot come from JSON'],
]);

/** Why a value of the type cannot come from JSON, or null if it can. */
export function notDecoded(type: Type, seen = new Set<Type>()): string | null {
  if (seen.has(type)) return null;
  seen.add(type);

  const inner = (types: readonly Type[]) => {
    for (const each of types) {
      const reason = notDecoded(each, seen);

      if (reason !== null) return reason;
    }

    return null;
  };

  switch (type.kind) {
    case 'number':
    case 'string':
    case 'bool':
    case 'null':
    case 'literal':
    case 'any':
    case 'unknown':
      return null;

    case 'bigint':
      return 'JSON has no bigint: decode a string and make it with BigInt(s)';

    case 'nullable':
      return inner([type.type]);

    case 'array':
      return inner([type.element]);

    case 'union':
      return inner(type.types);

    case 'param':
      return `${type.name} is a type parameter: decode needs a type known when the program compiles`;

    case 'function':
      return 'a function cannot come from JSON';

    case 'component':
      return 'a component cannot come from JSON';

    case 'classValue':
      return `the class ${type.info.name} cannot come from JSON`;

    case 'class':
      return (
        NOT_IN_JSON.get(type.info.name) ??
        `decode gives plain objects, without the methods of the class ${type.info.name}: decode an interface with its fields`
      );

    case 'object': {
      const name = type.instanceOf?.template.name ?? type.name;
      const known = name === null ? undefined : NOT_IN_JSON.get(name);

      if (known !== undefined) return known;
      if (isQueue(type)) return 'JSON has no queue: decode an array and make the queue from it';
      if (isTopic(type)) return 'a topic cannot come from JSON';
      if (typedArrayOf(type) !== null) return `JSON has no ${typeToString(type)}`;
      if (type.call || type.construct) {
        return `${typeToString(type)} is a function and cannot come from JSON`;
      }

      const members = [...memberNames(type.members)].flatMap(
        (name) => type.members.get(name) ?? [],
      );

      if (members.some((member) => member.method)) {
        return `${typeToString(type)} has methods, and JSON gives only data: decode an interface with its fields`;
      }

      return inner([...members.map((member) => member.type), ...(type.index ? [type.index] : [])]);
    }

    default:
      return `${typeToString(type)} cannot come from JSON`;
  }
}

/** Whether a value of the type is always a string: then decode reads it as JSON text. */
export function isText(type: Type): boolean {
  switch (type.kind) {
    case 'string':
      return true;

    case 'literal':
      return typeof type.value === 'string';

    case 'union':
      return type.types.every(isText);

    default:
      return false;
  }
}
