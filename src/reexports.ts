import type * as ast from './ast.ts';
import type { ImportResult } from './checker/checker.ts';
import { packageExports } from './codegen/imported.ts';
import { listenersName } from './codegen/shared.ts';
import { decoratedName } from './decorators.ts';
import type { InlinePackage } from './inline-packages.ts';

// `export { Rows } from "./rows.rk"` in JS: a component or a decorator goes with the hidden names
// that the modules using it import from where they import it (codegen/imported.ts), and state with
// its listeners. `export *` passes them all on by itself.

/** The JS names that each `export { ... } from` passes on, `name` or `name as other`. */
export function reexportedNames(
  program: ast.Program,
  importModule: ((specifier: string) => ImportResult) | undefined,
): Map<ast.ExportFromDeclaration, string[]> {
  const found = new Map<ast.ExportFromDeclaration, string[]>();

  for (const statement of program.body) {
    if (statement.kind !== 'ExportFromDeclaration' || !statement.specifiers) continue;

    const result = statement.source.value.endsWith('.rk')
      ? importModule?.(statement.source.value)
      : undefined;
    const exports = result && 'exports' in result ? result.exports : undefined;
    const names: string[] = [];
    const add = (name: string, as = name) => names.push(name === as ? name : `${name} as ${as}`);

    for (const { imported, local } of statement.specifiers) {
      const name = imported.name;

      // Without the types of the module, the name is passed on as it is written.
      if (!exports) {
        add(name, local.name);
        continue;
      }

      const component = exports.components?.get(name);
      const decorator = exports.decorators?.get(name);

      if (exports.values.has(name)) add(name, local.name);
      if (exports.shared?.has(name)) add(listenersName(name), listenersName(local.name));
      if (component) {
        add(`$$${name}`);
        for (const hidden of packageNames(name, component.inline)) add(hidden);
      }

      if (decorator) {
        for (const used of decorator.moduleNames) add(decoratedName(name, used));
        for (const hidden of packageNames(name, decorator.inline)) add(hidden);
      }
    }

    found.set(statement, [...new Set(names)]);
  }

  return found;
}

/** The hidden names that inlining the component or decorator `root` imports from its module. */
function packageNames(root: string, inline: InlinePackage | null): string[] {
  if (!inline) return [];

  return [
    ...packageExports(new Map([[root, inline]]), (name) => name).keys(),
    ...[...inline.functions.keys()].map((other) => `$$${other}`),
  ];
}
