import type * as ast from './ast.ts';
import { containsReturn } from './recursion.ts';

// Replacing the `return`s of a body, as decorators do: each `return` of a component goes through
// the wrappers of its decorators.

/** The statements with each `return` replaced; those of nested functions are their own. */
export function mapReturns(
  statements: readonly ast.Statement[],
  replace: (node: ast.ReturnStatement) => ast.Statement[],
): ast.Statement[] {
  return statements.flatMap((statement) =>
    statement.kind === 'ReturnStatement' ? replace(statement) : [withReplaced(statement, replace)],
  );
}

function withReplaced(
  statement: ast.Statement,
  replace: (node: ast.ReturnStatement) => ast.Statement[],
): ast.Statement {
  if (!containsReturn(statement)) return statement;

  const block = (node: ast.BlockStatement): ast.BlockStatement => ({
    ...node,
    body: mapReturns(node.body, replace),
  });

  switch (statement.kind) {
    case 'BlockStatement':
      return block(statement);

    case 'IfStatement': {
      const { alternate } = statement;

      return {
        ...statement,
        consequent: block(statement.consequent),
        alternate:
          alternate === null
            ? null
            : alternate.kind === 'IfStatement'
              ? (withReplaced(alternate, replace) as ast.IfStatement)
              : block(alternate),
      };
    }

    case 'ForStatement':
    case 'ForInStatement':
      return { ...statement, body: block(statement.body) };

    case 'SwitchStatement':
      return {
        ...statement,
        cases: statement.cases.map((switchCase) => ({
          ...switchCase,
          body: mapReturns(switchCase.body, replace),
        })),
      };

    case 'TryStatement':
      return {
        ...statement,
        block: block(statement.block),
        handler: statement.handler && { ...statement.handler, body: block(statement.handler.body) },
        finalizer: statement.finalizer && block(statement.finalizer),
      };

    default:
      return statement;
  }
}
