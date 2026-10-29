import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';
import type { Binding, BindingKind } from './context.ts';
import { IteratorChecker } from './iterators.ts';
import type { Type } from './types.ts';

// A channel, a topic, a tick or a signal that the module makes and never closes is a warning: a
// tick runs, a topic and a signal listen until they are closed, and a channel that is not closed
// leaves `for v in ch` waiting. A variable counts as closed if `close(x)` closes it, or if it goes to a function of the
// module that closes that parameter. One that goes anywhere else, such as to another module, to an
// object or out of a function, is left to that code and not checked.

/** What made a channel: `chan<T>()`, `topic<T>()`, `tick(ms)` or `signal(name)`. */
type Made = 'chan' | 'topic' | 'tick' | 'signal';

type Func = ast.FuncDeclaration | ast.FuncExpression;

interface Uses {
  closed: boolean;
  /** Goes where the module does not see what happens to it. */
  escapes: boolean;
  /** Arguments of functions of the module, with their positions. */
  passed: [Func, number][];
}

/** What `Channel.x(ch)` and `Topic.x(t)` do with a channel without keeping it. */
const OPERATIONS = new Set(['send', 'receive', 'range', 'stream', 'publish', 'listen', 'try']);

const MESSAGES: Readonly<Record<Made, (name: string) => string>> = {
  chan: (name) =>
    `"${name}" is never closed: close it when nothing more is sent, e.g. close(${name})`,
  topic: (name) =>
    `"${name}" is never closed, and a topic listens until it is closed: close it when it is no longer needed, e.g. close(${name}); a component closes it with defer close(${name}) in mount`,
  tick: (name) =>
    `"${name}" is never closed, and a tick runs until it is closed: e.g. close(${name})`,
  signal: (name) =>
    `"${name}" is never closed, and it keeps the program running until it is: close it once the signal has come, e.g. close(${name})`,
};

export abstract class ClosingChecker extends IteratorChecker {
  /** The identifier that declares a binding of this module. */
  private readonly declarations = new WeakMap<Binding, ast.Identifier>();

  /** What each name refers to: its declaration, or the name of a predeclared value. */
  private readonly references = new Map<ast.Identifier, ast.Identifier | string>();

  protected override declareValue(
    id: ast.Identifier,
    kind: BindingKind,
    type: Type | null,
  ): Binding {
    const binding = super.declareValue(id, kind, type);

    this.declarations.set(binding, id);

    return binding;
  }

  protected override checkIdentifier(node: ast.Identifier): Type {
    const binding = this.lookupValue(node.name);
    const declaration = binding && this.declarations.get(binding);

    if (declaration) this.references.set(node, declaration);
    else if (binding && binding === this.globals.values.get(node.name)) {
      this.references.set(node, node.name);
    }

    return super.checkIdentifier(node);
  }

  /** The functions declared in the module, by their names, which `use` looks arguments up in. */
  private functions = new Map<ast.Identifier, Func>();

  protected checkClosing(): void {
    const made: [ast.Identifier, Made][] = [];
    const uses = new Map<ast.Identifier, Uses>();
    const collect = (node: ast.Node): void => {
      if (node.kind === 'FuncDeclaration') this.functions.set(node.name, node);
      forEachChild(node, collect);
    };
    const visit = (node: ast.Node, parent: ast.Node | null): void => {
      const what =
        node.kind === 'VariableDeclaration' && !node.exported && node.names.length === 1
          ? node.values[0] && this.made(node.values[0])
          : null;

      if (node.kind === 'VariableDeclaration' && what) made.push([node.names[0]!, what]);

      const declaration = node.kind === 'Identifier' ? this.references.get(node) : undefined;

      if (node.kind === 'Identifier' && typeof declaration === 'object' && parent) {
        if (!uses.has(declaration)) {
          uses.set(declaration, { closed: false, escapes: false, passed: [] });
        }

        this.use(node, parent, uses.get(declaration)!);
      }

      forEachChild(node, (child) => visit(child, node));
    };

    collect(this.program);
    visit(this.program, null);

    // Whether a variable or a parameter is closed, goes where it is not seen, or neither.
    const fate = (id: ast.Identifier, seen: Set<ast.Identifier>): 'closed' | 'escapes' | 'none' => {
      const found = uses.get(id);

      if (!found || seen.has(id)) return 'none';
      if (found.closed) return 'closed';
      seen.add(id);

      let result: 'escapes' | 'none' = found.escapes ? 'escapes' : 'none';

      for (const [fn, i] of found.passed) {
        const param = fn.params[i];
        const inner = param && !param.rest ? fate(param.name, seen) : 'escapes';

        if (inner === 'closed') return 'closed';
        if (inner === 'escapes') result = 'escapes';
      }

      return result;
    };

    for (const [name, what] of made) {
      if (fate(name, new Set()) === 'none') this.warn(MESSAGES[what](name.name), name);
    }
  }

  /** `chan<T>()`, `topic<T>()`, `tick(ms)`, `signal(name)` and their `Channel.make` and the like. */
  private made(value: ast.Expression): Made | null {
    if (value.kind === 'ChanExpression') return 'chan';
    if (value.kind === 'TopicExpression') return 'topic';
    if (value.kind !== 'CallExpression') return null;

    const { callee } = value;

    if (callee.kind === 'Identifier') {
      const predeclared = this.references.get(callee);

      return predeclared === 'tick' || predeclared === 'signal' ? predeclared : null;
    }

    const member = this.predeclaredMember(callee);

    if (member === 'Channel.make') return 'chan';
    if (member === 'Channel.tick') return 'tick';
    if (member === 'Channel.signal') return 'signal';

    return member === 'Topic.make' ? 'topic' : null;
  }

  /** `Channel.close` and the like, as a name, when `Channel` is the predeclared one. */
  private predeclaredMember(node: ast.Expression): string | null {
    if (node.kind !== 'MemberExpression' || node.object.kind !== 'Identifier') return null;

    const object = this.references.get(node.object);

    return (object === 'Channel' || object === 'Topic') && node.property.kind === 'Identifier'
      ? `${object}.${node.property.name}`
      : null;
  }

  /** What the code around a name of a channel does with it. */
  private use(node: ast.Identifier, parent: ast.Node, found: Uses): void {
    switch (parent.kind) {
      case 'CallExpression': {
        const i = parent.arguments.indexOf(node);

        if (i < 0) return;

        const { callee } = parent;
        const ref = callee.kind === 'Identifier' ? this.references.get(callee) : undefined;
        const member = this.predeclaredMember(callee)?.split('.')[1];

        if (ref === 'close' || member === 'close') found.closed = true;
        else if (ref === 'stream' || (member !== undefined && OPERATIONS.has(member))) return;
        else {
          const fn =
            callee.kind === 'FuncExpression'
              ? callee
              : typeof ref === 'object'
                ? this.functions.get(ref)
                : undefined;

          if (fn) found.passed.push([fn, i]);
          else found.escapes = true;
        }

        return;
      }

      // Sending to it, receiving from it, a loop over it, comparing and assigning it keep it here;
      // sending it through a channel does not.
      case 'SendStatement':
        if (parent.value === node) found.escapes = true;

        return;

      case 'UnaryExpression':
        if (parent.operator !== '<-') found.escapes = true;

        return;

      case 'ForInStatement':
        return;

      case 'BinaryExpression':
        if (!['==', '!=', '===', '!=='].includes(parent.operator)) found.escapes = true;

        return;

      case 'AssignmentStatement':
        if (!parent.targets.includes(node)) found.escapes = true;

        return;

      default:
        found.escapes = true;
    }
  }
}
