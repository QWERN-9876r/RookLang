import type * as ast from './ast.ts';
import { type CopyListener, renamer } from './decorator-copy.ts';
import { aliases, decoratedName } from './decorator-names.ts';
import { declaredIn, freeNames, mentionsName, topLevelNames } from './names.ts';
import { containsReturn } from './recursion.ts';
import { forEachChild } from './walk.ts';

// Applying decorators: a component with decorators becomes one component whose body runs the
// bodies of its decorators first. The checker uses it to see what the inlined code uses, the
// generator to write it.

export { decoratedName, publicMembers } from './decorator-names.ts';

const argumentDeclarations = new WeakSet<ast.VariableDeclaration>();
const wrappedContents = new WeakSet<ast.Expression>();

/**
 * Whether a declaration of an applied component gets an argument of a decorator. When the
 * argument reads the component's properties, the declaration is a `state` that the properties
 * set again.
 */
export function isDecoratorArgument(node: ast.Statement): node is ast.VariableDeclaration {
  return node.kind === 'VariableDeclaration' && argumentDeclarations.has(node);
}

/**
 * Whether markup is what a component returns to the wrapper of a decorator, as in
 * `const $$visible$content = <section>...</section>`: it updates like returned markup.
 */
export function isWrappedContent(node: ast.Expression): boolean {
  return wrappedContents.has(node);
}

/** The markup that an applied component gives to the wrappers, whichever `return` it takes. */
export function wrappedMarkup(component: ast.ComponentDeclaration): ast.Expression[] {
  const found: ast.Expression[] = [];
  const visit = (node: ast.Node): void => {
    if (node.kind === 'VariableDeclaration') {
      found.push(...node.values.filter((value) => wrappedContents.has(value)));
    }

    forEachChild(node, visit);
  };

  visit(component.body);

  return found;
}

/** `return (content Element) => ...` at the end of a decorator's body. */
export interface Wrapper {
  fn: ast.ArrowFunction | ast.FuncExpression;
  param: ast.Parameter;
}

/** The wrapper of a decorator, when it returns a function literal with one parameter. */
export function wrapperOf(decorator: ast.DecoratorDeclaration): Wrapper | null {
  const last = decorator.body.body.at(-1);
  const [fn] = last?.kind === 'ReturnStatement' ? last.values : [];

  if (fn?.kind !== 'ArrowFunction' && fn?.kind !== 'FuncExpression') return null;

  const [param] = fn.params;

  return param && fn.params.length === 1 ? { fn, param } : null;
}

/** The statements of a wrapper; an expression body is what it returns. */
export function wrapperBody(fn: ast.ArrowFunction | ast.FuncExpression): ast.Statement[] {
  if (fn.body.kind === 'BlockStatement') return fn.body.body;

  return [{ kind: 'ReturnStatement', values: [fn.body], start: fn.body.start, end: fn.body.end }];
}

/** The parameter of a wrapper and its declarations, which go into the component's body too. */
export function wrapperNames(wrapper: Wrapper): string[] {
  return [wrapper.param.name.name, ...declaredIn(wrapperBody(wrapper.fn))];
}

/**
 * A decorator that components can apply. One from another module uses the names of its own module
 * through hidden exports, `$$visible$log`, so its code gets them renamed.
 */
export interface DecoratorSource {
  node: ast.DecoratorDeclaration;
  moduleNames: readonly string[];
  /** For one of another module: the tags here of the components of that module its code uses. */
  tags?: ReadonlyMap<string, string> | undefined;
}

/**
 * The names of its module that a decorator's code uses. Other modules that apply it get them
 * through hidden exports: `export { log as $$visible$log }`.
 */
export function moduleNamesOf(decorator: ast.DecoratorDeclaration, program: ast.Program): string[] {
  const topLevel = topLevelNames(program);

  return [...freeNames(decorator)].filter((name) => topLevel.has(name)).sort();
}

/** A wrapper copied for a component: a fresh copy of its body for each `return` it wraps. */
interface AppliedWrapper {
  content: ast.Identifier;
  type: ast.TypeNode | null;
  body: () => ast.Statement[];
}

/**
 * The component with its decorators applied. Its body first declares the arguments of each
 * decorator and runs its body, from the top decorator down, then runs the component's own body.
 * The names of a decorator get its prefix, `$$visible$shown`, so they clash neither with each other
 * nor with the component's names, and `@visible.shown` reads that variable. The `mount` of
 * the decorators runs after the component's own, from the inside out, so it goes before every
 * `return` of the component's body.
 *
 * A wrapper is inlined at every `return` too: `return <section />` becomes
 * `const $$visible$content = <section />`, then the body of the wrapper, whose `return` is the
 * component's. The wrappers apply from the bottom decorator up.
 *
 * `prefixes` replace the names of decorators in the prefixes: a module that inlines a component of
 * another one keeps the decorators of that module apart from its own, `$$Card$visible$shown`.
 */
export function decorate(
  component: ast.ComponentDeclaration,
  decorators: ReadonlyMap<string, DecoratorSource>,
  copied?: CopyListener,
  prefixes?: ReadonlyMap<string, string>,
): ast.ComponentDeclaration {
  if (component.decorators.length === 0) return component;

  // Arguments that read the properties, or such arguments of a decorator that includes another,
  // are state: they change with them.
  const reactive = new Set(component.params.map((param) => param.name.name));
  const setup: ast.Statement[] = [];
  const mounts: ast.Statement[][] = [];
  const wrappers: AppliedWrapper[] = [];
  // `argument` copies an argument into the component: one of the component stays as it is, one of
  // a decorator it includes is that decorator's code.
  const apply = (
    source: DecoratorSource,
    args: readonly ast.Expression[],
    argument: (value: ast.Expression) => ast.Expression,
    applying: ReadonlySet<ast.DecoratorDeclaration>,
  ): void => {
    const decorator = source.node;
    // A decorator that includes itself, through others too, is reported by the checker.
    const inner = new Set([...applying, decorator]);
    const prefix = prefixes?.get(decorator.name.name) ?? decorator.name.name;
    const names = [...decoratorNames(decorator), ...source.moduleNames];
    const renames = membersOf(prefix, names);
    const copy = renamer(renames, copied, { decorators: prefixes, tags: source.tags });

    decorator.params.forEach((param, i) => {
      const given = args[i];
      // A default value is the decorator's code.
      const value = given
        ? argument(given)
        : param.defaultValue && copy(param.defaultValue, new Set());
      const name = renames.get(param.name.name)!;
      const changes = value !== null && value !== undefined && mentionsName(value, reactive);
      const declaration: ast.VariableDeclaration = {
        kind: 'VariableDeclaration',
        exported: false,
        isPublic: false,
        keyword: changes ? 'state' : 'const',
        names: [{ ...param.name, name }],
        type: param.type,
        values: value ? [value] : [],
        body: null,
        start: param.start,
        end: param.end,
      };

      if (changes) reactive.add(name);
      argumentDeclarations.add(declaration);
      copied?.(declaration, param);
      setup.push(declaration);
    });

    for (const use of decorator.includes) {
      const included = decorators.get(use.name.name);

      if (!included || inner.has(included.node)) continue;
      apply(included, use.arguments, (value) => copy(value, new Set()), inner);
      setup.push(...aliases(included, use, prefix, decorators, prefixes));
    }

    const wrapper = wrapperOf(decorator);
    const own: ast.Statement[] = [];

    for (const statement of decorator.body.body) {
      if (wrapper && statement === decorator.body.body.at(-1)) continue;

      const renamed = copy(statement, new Set());

      if (renamed.kind === 'MountStatement') own.push(renamed);
      else setup.push(renamed);
    }

    mounts.push(own);
    if (wrapper) wrappers.push(applyWrapper(source, wrapper, copied, prefix, prefixes));
  };

  for (const use of component.decorators) {
    const source = decorators.get(use.name.name);

    if (source) apply(source, use.arguments, (value) => value, new Set());
  }

  const inside = mounts.reverse().flat();
  const chain = wrappers.reverse();
  const body =
    inside.length > 0 || chain.length > 0
      ? mapReturns(component.body.body, (node) => [...inside, ...wrapped(node, chain)])
      : component.body.body;

  return {
    ...component,
    decorators: [],
    body: { ...component.body, body: [...setup, ...body] },
  };
}

/** The parameters of a decorator and the declarations of its body: the names it renames. */
export function decoratorNames(decorator: ast.DecoratorDeclaration): Set<string> {
  const names = [
    ...decorator.params.map((param) => param.name.name),
    ...declaredIn(decorator.body.body),
  ];

  return new Set(names.filter((name) => name !== '_'));
}

function membersOf(prefix: string, names: Iterable<string>): Map<string, string> {
  const renames = new Map<string, string>();

  for (const name of names) {
    if (name !== '_') renames.set(name, decoratedName(prefix, name));
  }

  return renames;
}

/**
 * The names of the wrapper's code are renamed too: it goes into the component's body. Outside the
 * wrapper they are not the decorator's, so the rest of the body is copied without them.
 */
function applyWrapper(
  source: DecoratorSource,
  wrapper: Wrapper,
  copied: CopyListener | undefined,
  prefix: string,
  prefixes: ReadonlyMap<string, string> | undefined,
): AppliedWrapper {
  const names = [...decoratorNames(source.node), ...source.moduleNames, ...wrapperNames(wrapper)];
  const renames = membersOf(prefix, names);
  const copy = renamer(renames, copied, { decorators: prefixes, tags: source.tags });
  const { name } = wrapper.param;

  return {
    content: { ...name, name: renames.get(name.name) ?? name.name },
    type: wrapper.param.type,
    body: () => wrapperBody(wrapper.fn).map((statement) => copy(statement, new Set())),
  };
}

/** A `return` of the component through the wrappers, the innermost first. */
function wrapped(node: ast.ReturnStatement, chain: readonly AppliedWrapper[]): ast.Statement[] {
  const [wrapper, ...outer] = chain;
  const [value] = node.values;

  if (!wrapper || !value || node.values.length !== 1) return [node];
  wrappedContents.add(value);

  const content: ast.VariableDeclaration = {
    kind: 'VariableDeclaration',
    exported: false,
    isPublic: false,
    keyword: 'const',
    names: [{ ...wrapper.content }],
    type: wrapper.type,
    values: [value],
    body: null,
    start: node.start,
    end: node.end,
  };

  return [content, ...mapReturns(wrapper.body(), (inner) => wrapped(inner, outer))];
}

/** The statements with each `return` replaced; those of nested functions are their own. */
function mapReturns(
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
