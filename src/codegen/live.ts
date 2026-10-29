import type * as ast from '../ast.ts';

// What the updates of live markup are made of: the sources it depends on, and where the
// statements that bring it up to date go.

/** What markup can depend on: a `state` variable, or a property that gets the parent's state. */
export interface Source {
  /** Unique in the module; marks the places that change the source in the generated code. */
  readonly id: number;
  readonly name: string;
  /** `shared` is state of the module, which the component reads and listens to. */
  readonly kind: 'state' | 'prop' | 'shared';
  /** The function that brings dependent nodes up to date, e.g. `$$updateCount3`. */
  readonly update: string;
  /**
   * Statements that compute again the `derived` values that read it: `double = count * 2`. They
   * run first, also before the markup exists, so that the values are right whenever they are read.
   */
  readonly computations: string[];
  /** Statements that bring the nodes depending on it up to date. */
  readonly dependents: string[];
  /** Places that change it. */
  readonly writes: Write[];
  /**
   * A bound property, `bind active string`: the call that gives the parent its new value,
   * `$$bindActive?.(active);`. Places that change it make the call; the parent setting it does not.
   */
  bound: string | null;
}

export interface Write {
  /** Whether it may run before the markup exists: in a function of the body, not in a handler. */
  early: boolean;
  /** A dependent it does not need: `bind:` does not update its own element. */
  skip: number | null;
}

/** Everything a change of the source runs: the computations, then the updates of the nodes. */
export function updatesOf(source: Source): string[] {
  return [...source.computations, ...source.dependents];
}

/**
 * Where the updates of live markup go: the update functions of a component's state, or the update
 * of a block of `{if ...}` / `{for ...}`.
 */
export interface Live {
  /** Sources whose values an expression reads. */
  dependencies(node: ast.Node): Set<Source>;
  /** Adds a statement that brings a part of the markup up to date when the sources change. */
  depend(sources: ReadonlySet<Source>, statement: string): void;
  /** The index that the next statement for a source gets, for `bind:` to skip its own update. */
  ownIndex(source: Source): number | null;
}

/**
 * A block of markup control flow: a branch of `{if ...}` or the content for one item of
 * `{for ...}`. It is created again when needed, so its updates go into a function of its own,
 * which runs when any source that the block reads changes.
 */
export class Block implements Live {
  readonly statements: string[] = [];
  /** Sources that any statement depends on. */
  readonly sources = new Set<Source>();
  private readonly parent: Live;

  constructor(parent: Live) {
    this.parent = parent;
  }

  dependencies(node: ast.Node): Set<Source> {
    return this.parent.dependencies(node);
  }

  depend(sources: ReadonlySet<Source>, statement: string): void {
    this.statements.push(statement);
    for (const source of sources) this.sources.add(source);
  }

  ownIndex(): null {
    return null;
  }
}
