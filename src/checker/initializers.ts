import type * as ast from '../ast.ts';
import { mentionsName } from '../names.ts';
import type {
  Binding,
  ComponentInfo,
  ClassContext,
  DecoratorInfo,
  Flow,
  FunctionContext,
  Scope,
} from './context.ts';
import { TypeResolver } from './resolution.ts';
import { isUntyped } from './helpers.ts';
import {
  ANY,
  instanceMembers,
  isNullable,
  typeToString,
  UNKNOWN,
  type Member,
  type Type,
  type TypeParam,
} from './types.ts';

// Variables used in their own initializer. As in JS, a variable exists from the start of its
// declaration, and a function in the initializer runs after it, so the function can use the
// variable: `const timer = setInterval(() => clearInterval(timer), 1000)`. If the variable's type
// is not written, the body of such a function is checked once the variable has its type; this works
// when the type of the function is known without its body, as for a callback or a `func` literal.
// A use outside of functions reads the variable before it has a value, which is an error.

interface Initializer {
  declaration: ast.VariableDeclaration;
  bindings: Set<Binding>;
  /** Where the variables are declared: a use in this function, not in a nested one, is direct. */
  scope: Scope;
  fn: FunctionContext | null;
  /** Bodies of functions in the initializer that wait for the types of the variables. */
  deferred: (() => void)[];
}

export abstract class InitializerChecker extends TypeResolver {
  /** Initializers being checked, the outermost first. */
  private readonly initializers: Initializer[] = [];

  /**
   * Checks the initializer of `bindings` with `check`, which gives them their types, and then the
   * function bodies in it that waited for those types.
   */
  protected checkInitializer(
    declaration: ast.VariableDeclaration,
    bindings: readonly Binding[],
    check: () => void,
  ): void {
    const initializer: Initializer = {
      declaration,
      bindings: new Set(bindings),
      scope: this.scope,
      fn: this.fn,
      deferred: [],
    };

    this.initializers.push(initializer);
    try {
      check();
    } finally {
      this.initializers.pop();
    }

    for (const body of initializer.deferred) body();
  }

  /**
   * Defers `check`, the check of a function body, if the body mentions a variable that is being
   * initialized and has no type yet. Returns whether it was deferred.
   */
  protected deferBody(body: ast.Node, check: () => void): boolean {
    // The outermost initializer ends last: then every variable the body may use has its type.
    const initializer = this.initializers.find((candidate) => {
      const untyped = [...candidate.bindings].filter((binding) => binding.type === null);

      return untyped.length > 0 && mentionsName(body, new Set(untyped.map(({ name }) => name)));
    });

    if (!initializer) return false;

    const state = this.saveState();

    initializer.deferred.push(() => {
      const current = this.saveState();

      this.restoreState(state);
      try {
        check();
      } finally {
        this.restoreState(current);
      }
    });

    return true;
  }

  /** The error for `binding` used in its own initializer, or `null` if this use is fine. */
  protected initializerError(binding: Binding): string | null {
    const initializer = this.initializers.find((candidate) => candidate.bindings.has(binding));

    if (!initializer) return null;

    const { name } = binding;

    if (initializer.fn === this.fn) {
      const outer = this.lookupFrom(initializer.scope.parent, name);

      return outer
        ? `"${name}" here is the new variable, which has no value yet; give it another name to use the outer "${name}"`
        : `"${name}" is used in its own initializer, before it has a value`;
    }

    if (binding.type !== null) return null;

    const { declaration } = initializer;
    const value = declaration.values[declaration.names.findIndex((id) => id.name === name)];
    const isFunction = value?.kind === 'ArrowFunction' || value?.kind === 'FuncExpression';

    return isFunction
      ? `"${name}" is used in its own initializer: give it a type, e.g. ${declaration.keyword} ${name} func() = ...`
      : `"${name}" is used in its own initializer: write its type after the name`;
  }

  /**
   * `const { name, size: bytes, ...rest } = file`: the types of the fields, and of the rest, an
   * object with the other fields. A method would lose its object, so it is not taken.
   */
  protected patternTypes(node: ast.VariableDeclaration): Type[] {
    const { keys, rest } = node.pattern!;
    const value = node.values[0]!;
    const object = this.checkValue(value);

    if (isUntyped(object)) return node.names.map(() => ANY);
    if (isNullable(object)) {
      this.error(
        `cannot take the fields of ${typeToString(object)}: it may be null, check it first`,
        value,
      );

      return node.names.map(() => UNKNOWN);
    }

    const types = keys.map((key) => {
      const name = key.kind === 'Identifier' ? key.name : key.value;
      const member = this.findMember(object, name, key);

      if (member === 'any') return ANY;
      if (member?.method) {
        this.error(
          `"${name}" is a method: call it on the object, e.g. ${value.kind === 'Identifier' ? value.name : 'object'}.${name}()`,
          key,
        );
      }

      return member?.type ?? UNKNOWN;
    });

    if (!rest) return types;

    const taken = new Set(keys.map((key) => (key.kind === 'Identifier' ? key.name : key.value)));
    const all =
      object.kind === 'class'
        ? instanceMembers(object.info)
        : object.kind === 'object'
          ? object.members
          : new Map<string, Member>();
    const members = new Map(
      [...all].filter(
        ([name, member]) => !taken.has(name) && !member.method && member.visibility === 'public',
      ),
    );

    return [...types, { kind: 'object', name: null, members, call: null }];
  }

  private lookupFrom(scope: Scope | null, name: string): Binding | undefined {
    for (; scope; scope = scope.parent) {
      const binding = scope.values.get(name);

      if (binding) return binding;
    }

    return undefined;
  }

  private saveState(): CheckState {
    return {
      scope: this.scope,
      flow: new Map(this.flow),
      fn: this.fn,
      cls: this.cls,
      inferring: this.inferring,
      component: this.component,
      decorator: this.decorator,
    };
  }

  private restoreState(state: CheckState): void {
    ({
      scope: this.scope,
      flow: this.flow,
      fn: this.fn,
      cls: this.cls,
      inferring: this.inferring,
      component: this.component,
      decorator: this.decorator,
    } = state);
  }

  /**
   * `const LIMIT = 5` or `const NAMES []string = ...` of the module: its type, before the
   * statements are checked, for the fields of classes (Binding.early). Only a written type or a
   * literal value, which reads no other names; what is reported here is reported again later.
   */
  protected override typeEarly(node: ast.VariableDeclaration): void {
    const [name] = node.names;
    const [value] = node.values;
    const binding = name && this.scope.values.get(name.name);

    if (node.keyword !== 'const' || node.names.length !== 1 || !binding) return;
    if (!node.type && (node.values.length !== 1 || !value || !isLiteral(value))) return;

    const count = this.diagnostics.length;

    try {
      binding.early = node.type
        ? this.resolveType(node.type)
        : this.inferredType(this.checkValue(value!), value!);
    } finally {
      this.diagnostics.length = count;
    }
  }
}

/** Where in the program the checker is: what a deferred function body is checked with. */
interface CheckState {
  scope: Scope;
  flow: Flow;
  fn: FunctionContext | null;
  cls: ClassContext | null;
  inferring: ReadonlySet<TypeParam>;
  component: ComponentInfo | null;
  decorator: DecoratorInfo | null;
}

/** A value made of literals only: `5`, `"a"`, `-1`, `[1, 2]`, `{ retries: 3 }`. */
function isLiteral(node: ast.Expression): boolean {
  switch (node.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return true;

    case 'TemplateLiteral':
      return node.expressions.length === 0;

    case 'UnaryExpression':
      return node.operator === '-' && node.argument.kind === 'NumberLiteral';

    case 'ArrayLiteral':
      return (
        node.elements.length > 0 &&
        node.elements.every((element) => element.kind !== 'SpreadElement' && isLiteral(element))
      );

    case 'ObjectLiteral':
      return node.properties.every(
        (property) => property.kind === 'Property' && isLiteral(property.value),
      );

    default:
      return false;
  }
}
