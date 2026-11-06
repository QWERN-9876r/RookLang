import type * as ast from '../ast.ts';
import { wrapperBody } from '../decorators.ts';
import {
  withIncluded,
  type BindingKind,
  type ComponentInfo,
  type DecoratorInfo,
  type PublicMember,
  type Scope,
} from './context.ts';
import { DecoratorMemberChecker } from './decorator-members.ts';
import { isUntyped, ownStatements } from './helpers.ts';
import {
  commonType,
  isAssignable,
  typeToString,
  UNKNOWN,
  type FunctionType,
  type Type,
} from './types.ts';

// Decorators on the server (docs/server.md, "Decorators on the server"): their bodies run in the
// async function of the component, so they may wait; an early `return` of a value is the answer
// instead of the component, a guard; a wrapper takes and gives any value; and a component takes
// the public members of a decorator that a component above it applies, after `needs`.

export abstract class ServerDecoratorChecker extends DecoratorMemberChecker {
  /** Decorators whose bodies are checked: a component may need them before their turn. */
  private readonly checkedDecorators = new Set<DecoratorInfo>();

  protected override checkDecoratorBody(info: DecoratorInfo): void {
    if (this.checkedDecorators.has(info)) return;
    this.checkedDecorators.add(info);
    super.checkDecoratorBody(info);
  }

  protected override checkFunction(
    params: readonly ast.Parameter[],
    type: FunctionType,
    results: Type[] | null,
    body: ast.BlockStatement | ast.Expression,
    options: {
      isConstructor?: boolean;
      isComponent?: boolean;
      closure?: boolean;
      paramKind?: BindingKind;
      async?: boolean;
      mayEnd?: boolean;
      inspect?: (scope: Scope) => void;
    } = {},
  ): Type[] {
    // The body of a decorator runs in the async function of the component: it may wait.
    const waits = this.server && this.decorator !== null && body === this.decorator.node.body;

    return super.checkFunction(
      params,
      type,
      results,
      body,
      waits ? { ...options, async: true } : options,
    );
  }

  protected override checkWrapper(info: DecoratorInfo): void {
    if (!this.server) {
      super.checkWrapper(info);

      return;
    }

    const { body } = info.node;
    const last = body.body.at(-1);
    const guards: Type[] = [];

    for (const statement of ownStatements(body)) {
      if (statement.kind !== 'ReturnStatement' || (statement === last && info.wrapper)) continue;

      const [value] = statement.values;

      if (value === undefined || statement.values.length > 1) {
        this.error(
          'a guard returns the answer instead of the component, e.g. return reply("Forbidden", { status: 403 })',
          statement,
        );
      } else {
        guards.push(this.typeOfChecked(value));
      }
    }

    info.guards = guards;

    const end = info.wrapper && wrapperBody(info.wrapper.node.fn).at(-1);
    const [value] = end?.kind === 'ReturnStatement' ? end.values : [];

    if (info.wrapper) {
      if (!value) {
        this.error(
          'the wrapper ends with "return" of what it gives, e.g. return page',
          end ?? info.wrapper.node.fn,
        );
      }

      // Other modules take what it gives from here.
      info.wrapper.result = value ? this.typeOfChecked(value) : UNKNOWN;
    }
  }

  /** A component checks what it gives against its wrappers itself, in wrappedType. */
  protected override checkWrappedTypes(info: ComponentInfo): void {
    if (!this.server) super.checkWrappedTypes(info);
  }

  /** What the tag gives: through the wrappers from the bottom decorator up, or what a guard does. */
  protected override wrappedType(info: ComponentInfo, own: Type, seen: Set<ComponentInfo>): Type {
    if (!this.server) return super.wrappedType(info, own, seen);

    const decorators = withIncluded(info.decorators);
    let type = own;
    let source: string | null = null;

    for (const decorator of decorators) this.ensureChecked(decorator);
    for (const decorator of [...decorators].reverse()) {
      const { wrapper } = decorator;

      if (!wrapper) continue;

      const name = decorator.node.name.name;

      if (!isUntyped(type) && !isUntyped(wrapper.param) && !isAssignable(type, wrapper.param)) {
        const expected = typeToString(wrapper.param);
        const use = info.node.decorators.find((each) => each.name.name === name);

        this.error(
          source === null
            ? `@${name} wraps ${expected}, but ${info.node.name.name} gives ${typeToString(type)}: apply @${name} to a component that gives ${expected}`
            : `@${name} wraps ${expected}, but ${source} gives ${typeToString(type)}: change the order of the decorators or the type of the wrapper`,
          use ?? info.node.name,
        );
      }

      type = wrapper.result ?? UNKNOWN;
      source = `@${name}`;
    }

    return decorators.flatMap((each) => each.guards ?? []).reduce(commonType, type);
  }

  /** `@session.user` in a component that takes @session from a component above. */
  protected override findDecoratorMember(node: ast.DecoratorMember): PublicMember | null {
    const { component } = this;
    const name = node.decorator.name;
    const info = this.decorators.get(name);
    const needed =
      this.server &&
      !this.decorator &&
      component !== null &&
      (component.node.needs ?? []).some((each) => each.name === name) &&
      !withIncluded(component.decorators).some((each) => each.node.name.name === name);

    if (!needed || !info) return super.findDecoratorMember(node);
    this.ensureChecked(info);

    return this.publicMember(node, info);
  }

  protected override checkDecoratorsOf(info: ComponentInfo): void {
    for (const decorator of withIncluded(info.decorators)) this.ensureChecked(decorator);
    for (const name of info.node.needs ?? []) {
      const decorator = this.decorators.get(name.name);

      if (decorator) this.ensureChecked(decorator);
    }
  }

  /** A decorator of this module checked before the component that needs it. */
  private ensureChecked(info: DecoratorInfo): void {
    if (this.checkedDecorators.has(info) || this.importedDecorators.has(info)) return;
    this.atModuleLevel(() => this.checkDecoratorBody(info));
  }
}
