import { isChan } from './channel.ts';
import {
  isQueue,
  isTopic,
  memberNames,
  typedArrayOf,
  typeToString,
  type ClassInfo,
  type ObjectType,
  type Type,
  type TypeParam,
} from './types.ts';

// `make(File)`: the value of a type, computed when the program compiles, so that no type is left
// in the JS: `{ name: "", size: 0 }`. It is the zero value of the spec ("Zero values") and more: an
// interface gives an object of its fields, a class whose constructor takes nothing gives
// `new Cart()`, a literal type its literal. The checker uses it for its errors, and the code
// generator for the code.

/** The code of the value, or why the type has none. */
export type Made = { code: string } | { error: string };

export interface MakeContext {
  /** The code of `make(T)` for a type parameter: `$$Tmake()`, or the value of its one type. */
  param(param: TypeParam): Made;
  /** The name that the code uses for a class, or null if the module does not see it. */
  className(info: ClassInfo): string | null;
}

/** Library classes that `new` makes empty. */
const EMPTY_CLASSES = new Set(['Map', 'Set']);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function makeValue(type: Type, context: MakeContext): Made {
  return made(type, context, new Set());
}

function made(type: Type, context: MakeContext, seen: Set<Type>): Made {
  const typed = typedArrayOf(type);

  if (typed !== null) return { code: `new ${typed}()` };

  switch (type.kind) {
    case 'number':
      return { code: '0' };

    case 'bigint':
      return { code: '0n' };

    case 'string':
      return { code: '""' };

    case 'bool':
      return { code: 'false' };

    case 'array':
      return { code: '[]' };

    case 'nullable':
    case 'null':
    case 'any':
    case 'unknown':
      return { code: 'null' };

    case 'literal':
      return { code: type.value === undefined ? 'undefined' : JSON.stringify(type.value) };

    case 'param':
      return context.param(type);

    case 'object':
      return madeObject(type, context, seen);

    case 'class':
      return madeClass(type.info, context);

    case 'union':
      return {
        error: `${typeToString(type)} is a union, which has no value of its own; give the value, e.g. const x ${typeToString(type)} = ...`,
      };

    case 'function':
      return { error: `${typeToString(type)} is a function, which has no value of its own` };

    default:
      return { error: `${typeToString(type)} has no value of its own` };
  }
}

function madeObject(type: ObjectType, context: MakeContext, seen: Set<Type>): Made {
  // The type guards would leave `never` for the rest.
  const any: Type = type;

  if (isQueue(any)) return { code: 'new $$deque()' };
  if (isChan(any)) return { code: '$$channels.EMPTY' };
  if (isTopic(any)) return { code: '$$topics.EMPTY' };

  const template = type.instanceOf?.template ?? type;

  if (template.name !== null && EMPTY_CLASSES.has(template.name)) {
    return { code: `new ${template.name}()` };
  }

  if (type.call || type.construct || type.index || type.numberIndex) {
    return { error: `${typeToString(type)} has no value of its own` };
  }

  // A field of the type itself would make it without end.
  if (seen.has(template)) {
    return {
      error: `${typeToString(type)} has itself as a field; make the field nullable, e.g. next ?${typeToString(type)}`,
    };
  }

  const inner = new Set(seen).add(template);
  const fields: string[] = [];

  for (const key of memberNames(type.members)) {
    const member = type.members.get(key)!;

    if (member.method) {
      return {
        error: `${typeToString(type)} has the method "${key}", which has no value of its own`,
      };
    }

    // A field that may be missing is left out, as `decode` lets it be.
    if (member.type.kind === 'nullable' || member.type.kind === 'any') continue;

    const value = made(member.type, context, inner);

    if ('error' in value) return { error: `field "${key}": ${value.error}` };

    fields.push(`${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${value.code}`);
  }

  return { code: fields.length > 0 ? `{ ${fields.join(', ')} }` : '{}' };
}

/** `new Cart()`, for a class of Rook whose constructor takes nothing. */
function madeClass(info: ClassInfo, context: MakeContext): Made {
  // Only classes of Rook say what their constructor needs; `new Date()` would be the time.
  if (info.data === undefined) {
    return EMPTY_CLASSES.has(info.name)
      ? { code: `new ${info.name}()` }
      : {
          error: `${info.name} is a class of a library; call its constructor, e.g. new ${info.name}(...)`,
        };
  }

  if (info.abstract) {
    return { error: `${info.name} is abstract, so new ${info.name}() is not allowed` };
  }

  let owner: ClassInfo | null = info;

  while (owner && !owner.ctor) owner = owner.superClass;

  if (owner?.ctor && owner.ctor.required > 0) {
    return {
      error: `the constructor of ${info.name} takes arguments; call it, e.g. new ${info.name}(...)`,
    };
  }

  if (info.ctorVisibility !== 'public') {
    return { error: `the constructor of ${info.name} is ${info.ctorVisibility}` };
  }

  const name = context.className(info);

  return name === null
    ? {
        error: `the class ${info.name} is not a value here; import it, e.g. import { ${info.name} } from "./${info.name.toLowerCase()}.rk"`,
      }
    : { code: `new ${name}()` };
}

/** `() => 0`, `() => ({ name: "" })`: a function that makes the value again on each call. */
export function factory(code: string): string {
  return code.startsWith('{') ? `() => (${code})` : `() => ${code}`;
}
