import type * as ast from '../ast.ts';
import type { Type } from '../checker/types.ts';
import { forEachChild } from '../walk.ts';
import { rootName, writeTargets } from './mutations.ts';

// State of a module, `state items []Item = []` at its top level, which its components share. It
// is a variable with the set of the updates of the components that read it, `$$listeners$items`:
// a component adds its update while it is on the page, and a change of the state anywhere in the
// module runs them, `$$changed($$listeners$items)`. Other modules import both, and only read.

export interface SharedState {
  /** The sets of updates by the name of the state here: its own, and those it imports. */
  readonly listeners: ReadonlyMap<string, string>;
  /** The states of this module, which only it changes. */
  readonly own: ReadonlySet<string>;
  /** Names that refer into the value of a state of this module: `for item in items`. */
  readonly aliases: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The set of updates of a state: `$$listeners$items`, or that of its local name for an import. */
export function listenersName(name: string): string {
  return `$$listeners$${name}`;
}

/** The states of the program and those it imports, `local → name in its module`. */
export function sharedState(
  program: ast.Program,
  imported: ReadonlyMap<string, string> | undefined,
): SharedState {
  const own = new Set<string>();

  for (const statement of program.body) {
    if (statement.kind !== 'VariableDeclaration' || statement.keyword !== 'state') continue;
    for (const name of statement.names) if (name.name !== '_') own.add(name.name);
  }

  const listeners = new Map<string, string>();

  for (const name of [...own, ...(imported?.keys() ?? [])])
    listeners.set(name, listenersName(name));

  return { listeners, own, aliases: own.size > 0 ? aliasesOf(program, own) : new Map() };
}

/**
 * The states of this module that a statement changes, through them or through names that refer
 * into them. The analysis goes by names, as that of components: a local variable with the name of
 * a state only causes an extra run of the updates.
 */
export function sharedWrites(
  node: ast.Node,
  shared: SharedState,
  typeOf: (node: ast.Expression) => Type | undefined,
): string[] {
  if (shared.own.size === 0) return [];

  const found = new Set<string>();

  for (const target of writeTargets(node, typeOf)) {
    for (const name of rootsOf(target, shared)) found.add(name);
  }

  return [...found];
}

/** The states of this module whose value `node` refers into: `items`, `items[0]`, `item.tags`. */
export function rootsOf(node: ast.Expression, shared: SharedState): ReadonlySet<string> {
  const name = rootName(node);

  if (name === null) return new Set();
  if (shared.own.has(name)) return new Set([name]);

  return shared.aliases.get(name) ?? new Set();
}

/**
 * Names that refer into the states anywhere in the module: the items of `for item in items`, a
 * variable given `items[0]`, the parameters of a callback of `items.find(item => ...)`. Repeats
 * until nothing changes, since an alias of an alias is one too.
 */
function aliasesOf(program: ast.Program, own: ReadonlySet<string>): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>();
  const roots = (node: ast.Expression): ReadonlySet<string> =>
    rootsOf(node, { listeners: new Map(), own, aliases });
  let changed = true;
  const add = (name: string, states: ReadonlySet<string>) => {
    if (name === '_' || own.has(name)) return;
    for (const state of states) {
      const set = aliases.get(name) ?? new Set();

      if (set.has(state)) continue;
      set.add(state);
      aliases.set(name, set);
      changed = true;
    }
  };
  const visit = (node: ast.Node): void => {
    if (node.kind === 'ForInStatement') add(node.value.name, roots(node.iterable));
    if (node.kind === 'VariableDeclaration' && node.keyword !== 'state') {
      node.names.forEach((name, i) => {
        const value = node.values.length === node.names.length ? node.values[i] : node.values[0];

        if (value) add(name.name, roots(value));
      });
    }

    if (node.kind === 'CallExpression' && node.callee.kind === 'MemberExpression') {
      const states = roots(node.callee.object);

      for (const arg of node.arguments) {
        if (arg.kind !== 'ArrowFunction' && arg.kind !== 'FuncExpression') continue;
        for (const param of arg.params) add(param.name.name, states);
      }
    }

    forEachChild(node, visit);
  };

  while (changed) {
    changed = false;
    visit(program);
  }

  return aliases;
}
