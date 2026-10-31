import type * as ast from '../ast.ts';
import { containsBreak } from '../breaks.ts';
import type { Binding, Flow, Narrowing, Place } from './context.ts';
import {
  BIGINT,
  BOOL,
  isNullable,
  nonNull,
  NULL,
  NUMBER,
  STRING,
  typesEqual,
  union,
  unionMembers,
  type LiteralType,
  type Type,
} from './types.ts';

// Control flow for the checker: how conditions narrow the types of variables and paths, and which
// statements execution never continues after.

/** What a value of unknown type is after `typeof x == tag`. */
const PRIMITIVE_TAGS: ReadonlyMap<string, Type> = new Map([
  ['string', STRING],
  ['number', NUMBER],
  ['bigint', BIGINT],
  ['boolean', BOOL],
]);

/** What `typeof` gives for every value of a type, or `null` when it may give several things. */
export function typeofTag(type: Type): string | null {
  switch (type.kind) {
    case 'string':
    case 'number':
    case 'bigint':
      return type.kind;

    case 'bool':
      return 'boolean';

    case 'literal':
      return typeof type.value;

    case 'function':
    case 'component':
    case 'classValue':
      return 'function';

    case 'object':
      return type.call ? 'function' : 'object';

    case 'class':
    case 'array':
    case 'tuple':
    case 'null':
      return 'object';

    default:
      return null;
  }
}

/** The type after `typeof x == tag` is found true (`matches`) or false. */
export function narrowByTypeof(type: Type, tag: string, matches: boolean): Type | null {
  const base = nonNull(type);

  if (base.kind === 'any' || base.kind === 'unknown') {
    if (!matches) return null;

    return PRIMITIVE_TAGS.get(tag) ?? null;
  }

  const kept = unionMembers(base).filter((member) => {
    const memberTag = typeofTag(member);

    return memberTag === null || (memberTag === tag) === matches;
  });
  // typeof null is "object".
  const keepsNull = isNullable(type) && (tag === 'object') === matches;

  return union(keepsNull ? [...kept, NULL] : kept);
}

/** `"all"`, `42` or `true` written in the code: its value, or `undefined` for other expressions. */
export function literalValue(node: ast.Expression): string | number | boolean | undefined {
  switch (node.kind) {
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return node.value;

    default:
      return undefined;
  }
}

/** A type without one literal value: what is left after `x != "all"`. */
export function withoutLiteral(type: Type, value: string | number | boolean): Type {
  const kept = unionMembers(nonNull(type)).filter(
    (member) => !(member.kind === 'literal' && member.value === value),
  );

  return union(isNullable(type) ? [...kept, NULL] : kept);
}

/**
 * A union after a comparison of its tag, a field with literal types in each member: `tags` has the
 * values the tag may have in each member, `values` those it is compared with. When `equal`, the
 * members whose tag may be one of the values remain; otherwise those whose tag may be another one.
 */
export function narrowByTag(
  type: Type,
  tags: readonly (readonly LiteralType['value'][])[],
  values: readonly LiteralType['value'][],
  equal: boolean,
): Type {
  const kept = unionMembers(nonNull(type)).filter((_, i) => {
    const tag = tags[i] ?? [];

    return equal
      ? tag.some((value) => values.includes(value))
      : !tag.every((value) => values.includes(value));
  });

  return union(!equal && isNullable(type) ? [...kept, NULL] : kept);
}

/**
 * Whether `field` is a tag of what `place` was declared as: then an assignment to it may change
 * the member of the union that the place was narrowed to.
 */
export type IsTag = (place: Place, field: string) => boolean;

/**
 * Whether an assignment to the fields `written` of a variable ends the narrowing of `place`, a
 * path of the same variable or the variable itself (the empty path): it writes the path, its
 * start or a tag of it. `"delivery.kind"` ends the narrowing of `"delivery"`, which may come from
 * that tag; `"delivery.floor"` does not.
 */
export function overwrites(written: string, place: Place, isTag: IsTag): boolean {
  const { path } = place;

  if (written === '' || written === path || path.startsWith(`${written}.`)) return true;

  const field =
    path === '' ? written : written.startsWith(`${path}.`) ? written.slice(path.length + 1) : null;

  return field !== null && !field.includes('.') && isTag(place, field);
}

/** Ends the narrowing that an assignment to `binding` or to its fields `written` changes. */
export function forgetWritten(flow: Flow, binding: Binding, written: string, isTag: IsTag): void {
  for (const place of flow.keys()) {
    if (place.binding === binding && overwrites(written, place, isTag)) flow.delete(place);
  }
}

/** The flow without what assignments to the variables `names` and the paths `paths` change. */
export function withoutAssigned(
  flow: Flow,
  names: ReadonlySet<string>,
  paths: ReadonlySet<string>,
  isTag: IsTag,
): Flow {
  const written = [...paths].map((path) => path.split('.'));

  return new Map(
    [...flow].filter(
      ([place]) =>
        !names.has(place.binding.name) &&
        !written.some(
          ([root, ...fields]) =>
            root === place.binding.name && overwrites(fields.join('.'), place, isTag),
        ),
    ),
  );
}

export function withNarrowing(flow: Flow, narrowing: Narrowing): Flow {
  const result = new Map(flow);

  for (const [place, type] of narrowing) result.set(place, type);

  return result;
}

/** Narrowing that holds after both branches: the places narrowed the same way in both. */
export function mergeFlows(a: Flow, b: Flow): Flow {
  const result: Flow = new Map();

  for (const [place, type] of a) {
    const other = b.get(place);

    if (other && typesEqual(type, other)) result.set(place, type);
  }

  return result;
}

/** Go's terminating statements: execution never continues after them. */
/**
 * Statements that call a function whose result is `never`, `process.exit(1)`: the checker marks
 * them, and they end a block as `throw` does.
 */
const neverEnding = new WeakSet<ast.Statement>();

export function markNeverEnding(node: ast.Statement): void {
  neverEnding.add(node);
}

export function isTerminating(node: ast.Statement): boolean {
  switch (node.kind) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;

    case 'ExpressionStatement':
      return neverEnding.has(node);

    case 'BlockStatement': {
      const last = node.body.at(-1);

      return last !== undefined && isTerminating(last);
    }

    case 'IfStatement':
      return (
        node.alternate !== null && isTerminating(node.consequent) && isTerminating(node.alternate)
      );

    case 'ForStatement':
      return node.condition === null && !containsBreak(node.body.body, node.label ?? null);

    case 'SwitchStatement':
      return (
        node.cases.some((switchCase) => switchCase.tests.length === 0) &&
        node.cases.every((switchCase) => {
          const last = switchCase.body.at(-1);

          return (
            last !== undefined &&
            isTerminating(last) &&
            !containsBreak(switchCase.body, node.label ?? null)
          );
        })
      );

    // A select runs one of its cases, waiting for one if there is no default.
    case 'SelectStatement':
      return node.cases.every((selectCase) => {
        const last = selectCase.body.at(-1);

        return (
          last !== undefined &&
          isTerminating(last) &&
          !containsBreak(selectCase.body, node.label ?? null)
        );
      });

    case 'TryStatement':
      return (
        (isTerminating(node.block) && (!node.handler || isTerminating(node.handler.body))) ||
        (node.finalizer !== null && isTerminating(node.finalizer))
      );

    default:
      return false;
  }
}

/** Whether execution never continues after the statement, counting `break` and `continue`. */
export function leaves(node: ast.Statement): boolean {
  switch (node.kind) {
    case 'BreakStatement':
    case 'ContinueStatement':
      return true;

    case 'BlockStatement': {
      const last = node.body.at(-1);

      return last !== undefined && leaves(last);
    }

    case 'IfStatement':
      return node.alternate !== null && leaves(node.consequent) && leaves(node.alternate);

    default:
      return isTerminating(node);
  }
}
