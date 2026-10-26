import type * as ast from './ast.ts';
import { forEachChild } from './walk.ts';

/**
 * Whether a `break` in these statements leaves the enclosing loop or switch: an unlabeled one
 * outside of nested loops and switches, or `break label` anywhere when `label` is the statement's.
 */
export function containsBreak(
  statements: readonly ast.Statement[],
  label: ast.Identifier | null = null,
): boolean {
  let found = false;
  const visit = (node: ast.Node, nested: boolean): void => {
    switch (node.kind) {
      case 'BreakStatement':
        if (node.label ? node.label.name === label?.name : !nested) found = true;

        return;

      // An unlabeled `break` inside these belongs to them.
      case 'ForStatement':
      case 'ForInStatement':
      case 'SwitchStatement':
      case 'SelectStatement':
        if (label !== null) forEachChild(node, (child) => visit(child, true));

        return;

      case 'FuncDeclaration':
      case 'FuncExpression':
      case 'ArrowFunction':
      case 'ClassDeclaration':
      case 'MountStatement':
      case 'EffectStatement':
        return;

      default:
        forEachChild(node, (child) => visit(child, nested));
    }
  };

  for (const statement of statements) visit(statement, false);

  return found;
}
