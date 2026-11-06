import type * as ast from './ast.ts';

// The context of a request on the server (docs/server.md, "Context"): a component gives the public
// members of the decorators applied to it to the components below, and takes those it needs from
// above. The checker and the generator see the same decorators here, by their declarations.

/** The decorators applied to a component, with those they include, which come first. */
export function appliedDecorators(
  component: ast.ComponentDeclaration,
  decorators: ReadonlyMap<string, ast.DecoratorDeclaration>,
): ast.DecoratorDeclaration[] {
  const found: ast.DecoratorDeclaration[] = [];
  const add = (name: string): void => {
    const decorator = decorators.get(name);

    if (!decorator || found.includes(decorator)) return;
    for (const use of decorator.includes) add(use.name.name);
    found.push(decorator);
  };

  for (const use of component.decorators) add(use.name.name);

  return found;
}

/**
 * The decorators a component takes from a component above: those after its `needs`, and those
 * that its decorators need but it does not apply.
 */
export function neededDecorators(
  component: ast.ComponentDeclaration,
  decorators: ReadonlyMap<string, ast.DecoratorDeclaration>,
): string[] {
  const applied = appliedDecorators(component, decorators);
  const own = new Set(applied.map((each) => each.name.name));
  const names = [...(component.needs ?? []), ...applied.flatMap((each) => each.needs)];

  return [...new Set(names.map((name) => name.name))].filter((name) => !own.has(name));
}

/** What a component gives the components below it, and takes from above: the context it sees. */
export function contextOf(
  component: ast.ComponentDeclaration,
  decorators: ReadonlyMap<string, ast.DecoratorDeclaration>,
): Set<string> {
  return new Set([
    ...appliedDecorators(component, decorators).map((each) => each.name.name),
    ...neededDecorators(component, decorators),
  ]);
}
