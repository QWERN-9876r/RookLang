import type * as ast from './ast.ts';
import type { DecoratorSource } from './decorators.ts';

// The names of the members of decorators in the components they are applied to, and the members
// that a decorator gives with those of the decorators it includes.

/** The JS name of a member or a parameter of a decorator, in the components it is applied to. */
export function decoratedName(decorator: string, member: string): string {
  return `$$${decorator}$${member}`;
}

/**
 * The public members that a decorator gives the components it is applied to: its own and those of
 * the decorators it includes, each with whether it changes (state and derived values do).
 */
export function publicMembers(
  decorator: ast.DecoratorDeclaration,
  decorators: ReadonlyMap<string, DecoratorSource>,
  seen: ReadonlySet<ast.DecoratorDeclaration> = new Set(),
): Map<string, boolean> {
  const members = new Map<string, boolean>();
  const inner = new Set([...seen, decorator]);

  for (const use of decorator.includes) {
    const included = decorators.get(use.name.name);

    if (!included || inner.has(included.node)) continue;
    for (const [name, changes] of publicMembers(included.node, decorators, inner)) {
      members.set(name, changes);
    }
  }

  for (const statement of decorator.body.body) {
    if (statement.kind === 'FuncDeclaration' && statement.isPublic) {
      members.set(statement.name.name, false);
    } else if (statement.kind === 'VariableDeclaration' && statement.isPublic) {
      const changes = statement.keyword === 'state' || statement.keyword === 'derived';

      for (const name of statement.names) members.set(name.name, changes);
    }
  }

  return members;
}

/**
 * `@shop.count` of a member that `shop` gets from the `cart` it includes: a variable of `shop`
 * that is that of `cart`, `derived` when it changes, so that what reads it is updated.
 */
export function aliases(
  included: DecoratorSource,
  use: ast.DecoratorUse,
  prefix: string,
  decorators: ReadonlyMap<string, DecoratorSource>,
  prefixes: ReadonlyMap<string, string> | undefined,
): ast.VariableDeclaration[] {
  const from = prefixes?.get(included.node.name.name) ?? included.node.name.name;

  return [...publicMembers(included.node, decorators)].map(([member, changes]) => ({
    kind: 'VariableDeclaration',
    exported: false,
    isPublic: false,
    keyword: changes ? 'derived' : 'const',
    names: [
      { kind: 'Identifier', name: decoratedName(prefix, member), start: use.start, end: use.end },
    ],
    type: null,
    values: [
      { kind: 'Identifier', name: decoratedName(from, member), start: use.start, end: use.end },
    ],
    body: null,
    start: use.start,
    end: use.end,
  }));
}
