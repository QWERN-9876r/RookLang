import type * as ast from '../ast.ts';
import { ComponentGenericsChecker } from './component-generics.ts';
import type { ComponentInfo } from './context.ts';
import { contextOf, neededDecorators } from '../server-context.ts';
import { isComponentTag } from './server-markup.ts';
import { contentResult, HTML } from './server.ts';
import { isTerminating } from './flow.ts';
import { awaited } from './promise.ts';
import {
  ANY,
  func,
  isAssignable,
  substitute,
  typeToString,
  UNKNOWN,
  VOID,
  type Type,
  type TypeParam,
} from './types.ts';

// Components on the server (docs/server.md): async functions of their properties, which return
// any value. The result is written after the properties or inferred from the returns; a use of a
// component may come before its body is checked, so the body is checked when its result is first
// needed. What only the browser has, state and mount among others, is an error.

export abstract class ServerComponentChecker extends ComponentGenericsChecker {
  /**
   * The bodies of the decorators that a component applies or needs, checked before its own: it
   * reads their public members. Implemented by ServerDecoratorChecker.
   */
  protected abstract checkDecoratorsOf(info: ComponentInfo): void;

  /** The results of the components of the module whose bodies are checked. */
  private readonly serverResults = new Map<ComponentInfo, Type>();

  /** Components whose bodies are being checked: a use of one of them inside is recursion. */
  private readonly checkingBodies = new Set<ComponentInfo>();

  /** `comp Logger<T>(...)`: the type parameters, which a use infers from its children. */
  private readonly typeParams = new Map<ComponentInfo, TypeParam[]>();

  protected override resolveProps(info: ComponentInfo): void {
    if (!this.server) {
      super.resolveProps(info);

      return;
    }

    const params = this.createTypeParams(info.node.typeParams ?? []);

    this.typeParams.set(info, params);
    this.withTypeParams(params, info.node.typeParams ?? [], () => super.resolveProps(info));
    // On the server every component is a function: nothing is inlined.
    info.isFunction = true;
  }

  protected override checkComponentBody(info: ComponentInfo): void {
    if (!this.server) {
      super.checkComponentBody(info);

      return;
    }

    if (this.serverResults.has(info) || this.checkingBodies.has(info)) return;
    // The body may be checked from inside another one, where its result is first needed.
    this.atModuleLevel(() => this.checkServerBody(info));
  }

  private checkServerBody(info: ComponentInfo): void {
    const { node } = info;
    const typeParams = this.typeParams.get(info) ?? [];
    const declared = this.withTypeParams(typeParams, null, () =>
      node.result ? this.resolveType(node.result) : null,
    );

    this.checkDecoratorUses(info);
    this.checkDecoratorsOf(info);
    for (const name of node.needs ?? []) {
      if (!this.decorators.has(name.name)) this.error(`unknown decorator @${name.name}`, name);
    }

    this.component = info;
    this.checkingBodies.add(info);
    try {
      // state, ref, mount and the like are declared at the top of the body.
      for (const statement of node.body.body) this.checkServerStatement(statement);

      const types = node.params.map((param) => info.props.get(param.name.name)?.type ?? UNKNOWN);

      node.params.forEach((param, i) => {
        if (param.defaultValue) {
          this.expectAssignable(
            this.checkValue(param.defaultValue, types[i]),
            types[i]!,
            param.defaultValue,
          );
        }
      });
      if (!declared && !isTerminating(node.body)) {
        this.error('a component ends with "return" of its result, e.g. return <p>...</p>', {
          start: node.body.end - 1,
          end: node.body.end,
        });
      }

      const results = this.withClass(null, () =>
        this.checkFunction(
          node.params,
          func(types, [], { typeParams }),
          declared ? [declared] : null,
          node.body,
          {
            paramKind: 'prop',
            isComponent: true,
            // It may wait, and the tag waits for it: its result is not a Promise.
            async: true,
          },
        ),
      );
      const own = declared ?? (results.length === 1 ? awaited(results[0]!) : VOID);
      // What the tag gives: through the wrappers of the decorators, or what a guard answers.
      const result = this.wrappedType(info, own, new Set());

      this.serverResults.set(info, result);
      // Other modules get the type of <Card /> from here.
      info.result = result;
    } finally {
      this.checkingBodies.delete(info);
    }
  }

  /** Runs a check as at the top level of the module, where a body is checked. */
  protected atModuleLevel<T>(check: () => T): T {
    const saved = {
      scope: this.scope,
      flow: this.flow,
      fn: this.fn,
      component: this.component,
      decorator: this.decorator,
      depth: this.markupDepth,
      waits: this.waitsFor,
      content: this.contentChild,
    };

    this.scope = this.moduleScope;
    this.flow = new Map();
    this.fn = null;
    this.component = null;
    this.decorator = null;
    this.markupDepth = 0;
    this.waitsFor = null;
    this.contentChild = null;
    try {
      return check();
    } finally {
      this.scope = saved.scope;
      this.flow = saved.flow;
      this.fn = saved.fn;
      this.component = saved.component;
      this.decorator = saved.decorator;
      this.markupDepth = saved.depth;
      this.waitsFor = saved.waits;
      this.contentChild = saved.content;
    }
  }

  /** The type of `<Card />`: what the component returns. */
  protected override componentResult(info: ComponentInfo, seen: Set<ComponentInfo>): Type {
    if (!this.server) return super.componentResult(info, seen);
    // A component of another module was checked there.
    if (info.result || !this.program.body.includes(info.node)) return info.result ?? UNKNOWN;

    const written = info.node.result;

    if (written) {
      const own = this.withModuleScope(() =>
        this.withTypeParams(this.typeParams.get(info) ?? [], null, () => this.resolveType(written)),
      );

      return this.wrappedType(info, own, new Set());
    }

    if (this.checkingBodies.has(info)) return UNKNOWN;
    this.checkComponentBody(info);

    return this.serverResults.get(info) ?? UNKNOWN;
  }

  protected override checkComponentUse(node: ast.ElementExpression, tag: ast.Identifier): Type {
    const info = this.server ? this.lookupValue(tag.name)?.component : undefined;

    // A component that uses itself is checked before its result is known.
    if (info && !info.node.result && this.checkingBodies.has(info)) {
      const props = info.node.params.map(
        (param) =>
          `${param.name.name} ${typeToString(info.props.get(param.name.name)?.type ?? UNKNOWN)}`,
      );

      this.error(
        `"${tag.name}" uses itself, so it writes the type of its result after the properties, e.g. comp ${tag.name}(${props.join(', ')}) Html`,
        tag,
      );
    }

    if (!info) return super.checkComponentUse(node, tag);
    this.checkContext(info, tag);

    // What the children give goes to `Content<T>`, not into markup, when there is one component.
    const children = info.props.get('children')?.type;
    const expected = children ? contentResult(children) : null;
    const [only] = node.children;
    const single =
      node.children.length === 1 && only?.kind === 'ElementExpression' && isComponentTag(only)
        ? only
        : null;
    const saved = this.contentChild;

    this.contentChild = expected !== null && expected !== HTML ? single : null;

    let result: Type;

    try {
      result = super.checkComponentUse(node, tag);
    } finally {
      this.contentChild = saved;
    }

    // Children that are markup, `Content` of Html, are Html: a Response among them goes up.
    const given = single && expected !== HTML ? (this.tagTypes.get(single) ?? UNKNOWN) : HTML;

    if (expected === null || node.children.length === 0) return result;
    if (expected.kind === 'param') {
      // `<Logger><Users /></Logger>` is what Users gives.
      return substitute(result, new Map([[expected, given]]), ANY);
    }

    if (!isAssignable(given, expected)) {
      this.error(
        `the children of <${tag.name}> give ${typeToString(given)}, but it takes Content<${typeToString(expected)}>`,
        node.children[0]!,
      );
    }

    return result;
  }

  /** State of the module, decorators and web components: errors on the server. */
  protected checkServerModule(): void {
    if (!this.server) return;
    for (const statement of this.program.body) {
      if (statement.kind === 'VariableDeclaration' && statement.keyword === 'state') {
        this.error(
          'state of a module would be shared by all requests on the server: use let for what they share on purpose, or pass it down',
          statement,
        );
      } else if (statement.kind === 'ComponentDeclaration' && statement.htmlTag) {
        this.error(
          '@html-tag makes a component of the browser: write it in a package with "rook": { "markup": true }',
          statement.htmlTag,
        );
      }
    }
  }

  /**
   * The decorators a component needs come from a component above: the one that uses it applies
   * them, or needs them too. A component value is checked when the request runs.
   */
  private checkContext(info: ComponentInfo, tag: ast.Identifier): void {
    if (this.decorator) return;

    const declarations = new Map([...this.decorators].map(([name, each]) => [name, each.node]));
    const around = this.component ? contextOf(this.component.node, declarations) : new Set();

    for (const name of neededDecorators(info.node, declarations)) {
      if (around.has(name)) continue;

      const user = this.component?.node.name.name;

      this.error(
        user
          ? `<${tag.name} /> needs @${name} from a component above it; apply @${name} to ${user}, or add "needs ${name}" to it`
          : `<${tag.name} /> needs @${name} from a component above it; use it inside a component that applies @${name}`,
        tag,
      );
    }
  }

  /** A statement of the body of a component that only the browser has. */
  private checkServerStatement(statement: ast.Statement): void {
    const problem =
      statement.kind === 'VariableDeclaration' &&
      (statement.keyword === 'state' || statement.keyword === 'derived')
        ? `"${statement.keyword}" has no meaning on the server: a component runs once for a request; use ${statement.keyword === 'state' ? 'let or const' : 'const'}`
        : statement.kind === 'VariableDeclaration' && statement.keyword === 'ref'
          ? '"ref" has no meaning on the server: there are no elements, only a string of HTML'
          : statement.kind === 'MountStatement'
            ? '"mount" has no meaning on the server: there is nothing to mount; use defer to clean up'
            : statement.kind === 'EffectStatement'
              ? '"effect" has no meaning on the server: a component runs once for a request; write its code in the body'
              : statement.kind === 'StyleStatement'
                ? '"style" is not supported on the server yet: give the page a stylesheet, e.g. <link rel="stylesheet" href="/app.css" />'
                : null;

    if (problem) this.error(problem, statement);
  }

  private withModuleScope<T>(check: () => T): T {
    const saved = this.scope;

    this.scope = this.moduleScope;
    try {
      return check();
    } finally {
      this.scope = saved;
    }
  }
}
