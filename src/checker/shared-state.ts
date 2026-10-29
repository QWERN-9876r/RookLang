import type * as ast from '../ast.ts';
import { mayChange } from '../methods.ts';
import { ImportChecker } from './imports.ts';
import type { Binding } from './context.ts';

// State shared by components: `state items []Item = []` at the top level of a module. Its module
// changes it anywhere; other modules import it to read, and change it only by calling a function
// of its module, so that the module keeps its data consistent, as a decorator keeps its state.

export abstract class SharedStateChecker extends ImportChecker {
  /** `items = []` or `items[0].done = true` in a module that imported `items`. */
  protected checkSharedWrite(target: ast.Expression): boolean {
    const shared = this.importedShared(target);

    if (shared) this.sharedError(shared, target);

    return shared !== null;
  }

  /** `items.push(x)`: a method that changes state that another module shares. */
  protected checkSharedMutation(node: ast.CallExpression): void {
    const { callee } = node;

    if (callee.kind !== 'MemberExpression') return;

    const shared = this.importedShared(callee.object);

    if (shared && mayChange(this.typeOfChecked(callee.object), callee.property.name)) {
      this.sharedError(shared, node);
    }
  }

  /** The import that a target writes into, `items` of `items[0].done`, if it is shared state. */
  private importedShared(target: ast.Expression): Binding | null {
    let root = target;

    while (root.kind === 'MemberExpression' || root.kind === 'IndexExpression') root = root.object;
    if (root.kind !== 'Identifier') return null;

    const binding = this.lookupValue(root.name);

    return binding?.shared ? binding : null;
  }

  private sharedError(binding: Binding, node: ast.NodeBase): void {
    this.error(
      `"${binding.name}" is state of "${binding.shared}", which is read-only here; change it with a function that "${binding.shared}" exports`,
      node,
    );
  }
}
