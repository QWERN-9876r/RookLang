import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';

// The option `trace`: the generated code tells the runtime where each operation of goroutines
// and channels is in the source, and which variable a channel is made for, so that a listener of
// tracing (src/runtime/trace.js) can show them. Without the option the code is as it was.

/** The line of the source, from 1, where the character at `offset` is. */
export function lineAt(source: string, offset: number): number {
  let line = 1;

  for (let at = source.indexOf('\n'); at >= 0 && at < offset; at = source.indexOf('\n', at + 1)) {
    line++;
  }

  return line;
}

/** The names of the variables that channels are made for: `const jobs = chan<number>(2)`. */
export function channelNames(program: ast.Program): Map<ast.ChanExpression, string> {
  const names = new Map<ast.ChanExpression, string>();
  const visit = (node: ast.Node): void => {
    if (node.kind === 'VariableDeclaration') {
      node.values.forEach((value, i) => {
        const name = node.names[i];

        if (value.kind === 'ChanExpression' && name) names.set(value, name.name);
      });
    }

    forEachChild(node, visit);
  };

  visit(program);

  return names;
}
