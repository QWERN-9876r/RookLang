// `decode<T>(x)`: JSON text, or a value from JS, checked against the type T, which the compiler
// writes as data: "number", "string", "bool", "any", { literal: [values] }, { nullable: T },
// { array: T }, { record: T }, { union: [types] } and $$type(name, fields) for an object. A value
// that fits is returned as it is, with the fields that T does not have; a nullable field may be
// missing. The error says where the value does not fit: `decode User: tags[1]: expected string,
// got 42`.

/** An object type. Its fields come from a function, so that types can refer to each other. */
export function $$type(name, fields) {
  let resolved = null;

  return {
    name,
    get fields() {
      return (resolved ??= fields());
    },
  };
}

/** `decode<T>(text)` of a string: the JSON text is parsed, then checked. */
export function $$decodeJson(text, type) {
  let value;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return [null, new Error(`decode ${describe(type)}: invalid JSON: ${error.message}`)];
  }

  return $$decode(value, type);
}

/**
 * `decode<T>(value)` of a value from JS. Without the types of the checker (`rook build --no-check`)
 * the type is null: then a string is parsed as JSON text, and nothing is checked.
 */
export function $$decode(value, type) {
  if (type === null) return typeof value === 'string' ? $$decodeJson(value, 'any') : [value, null];

  const problem = check(value, type, []);

  if (problem === null) return [value, null];

  const where = problem.path.length > 0 ? `${pathText(problem.path)}: ` : '';

  return [null, new Error(`decode ${describe(type)}: ${where}${problem.message}`)];
}

const PRIMITIVES = { number: 'number', string: 'string', bool: 'boolean' };

/** Where and how the value does not fit the type, or null if it does. */
function check(value, type, path) {
  if (typeof type === 'string') {
    return type === 'any' || typeof value === PRIMITIVES[type] ? null : mismatch(value, type, path);
  }

  if ('literal' in type) return type.literal.includes(value) ? null : mismatch(value, type, path);

  if ('nullable' in type) {
    if (value == null) return null;

    const problem = check(value, type.nullable, path);

    // The value itself is of another type: the message names ?T, not T.
    return problem !== null && problem.path.length === path.length
      ? mismatch(value, type, path)
      : problem;
  }

  if ('array' in type) {
    if (!Array.isArray(value)) return mismatch(value, type, path);

    for (let i = 0; i < value.length; i++) {
      const problem = check(value[i], type.array, [...path, i]);

      if (problem !== null) return problem;
    }

    return null;
  }

  if ('union' in type) return checkUnion(value, type, path);
  if (!isObject(value)) return mismatch(value, type, path);

  if ('record' in type) {
    for (const key of Object.keys(value)) {
      const problem = check(value[key], type.record, [...path, key]);

      if (problem !== null) return problem;
    }

    return null;
  }

  for (const [name, field] of Object.entries(type.fields)) {
    // Only own fields: a field named `toString` is not the method of every object.
    if (!Object.hasOwn(value, name)) {
      if (isOptional(field)) continue;

      return { path: [...path, name], message: 'missing' };
    }

    const problem = check(value[name], field, [...path, name]);

    if (problem !== null) return problem;
  }

  return null;
}

/**
 * The value fits one of the types. If none fits, the type whose check went deepest into the value
 * is most likely the one meant, `{ kind: "circle", r: "2" }` of `Circle | Square`, so its problem
 * is the one reported.
 */
function checkUnion(value, type, path) {
  let deepest = null;

  for (const member of type.union) {
    const problem = check(value, member, path);

    if (problem === null) return null;
    if (problem.path.length > (deepest?.path.length ?? path.length)) deepest = problem;
  }

  return deepest ?? mismatch(value, type, path);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptional(type) {
  return type === 'any' || (typeof type === 'object' && 'nullable' in type);
}

function mismatch(value, type, path) {
  return { path, message: `expected ${describe(type)}, got ${shown(value)}` };
}

/** The type as Rook writes it: `[]string`, `?User`, `"admin" | "user"`. */
function describe(type) {
  if (typeof type === 'string') return type;
  if ('literal' in type) return type.literal.map((value) => JSON.stringify(value)).join(' | ');
  if ('nullable' in type) return `?${grouped(type.nullable)}`;
  if ('array' in type) return `[]${grouped(type.array)}`;
  if ('record' in type) return `{ [key string]: ${describe(type.record)} }`;
  if ('union' in type) return type.union.map(describe).join(' | ');

  return type.name;
}

function grouped(type) {
  const several = typeof type === 'object' && ('union' in type || type.literal?.length > 1);

  return several ? `(${describe(type)})` : describe(type);
}

/** The value in a message: a primitive itself, a long string cut, and the kind of anything else. */
function shown(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

    case 'number':
    case 'boolean':
      return String(value);

    case 'object':
      return 'an object';

    default:
      return typeof value;
  }
}

/** `tags[1]`, `boss.name`, `["first name"]`. */
function pathText(path) {
  return path
    .map((key, i) => {
      if (typeof key === 'number') return `[${key}]`;
      if (/^[A-Za-z_$][\w$]*$/.test(key)) return i === 0 ? key : `.${key}`;

      return `[${JSON.stringify(key)}]`;
    })
    .join('');
}
