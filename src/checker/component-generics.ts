import type * as ast from '../ast.ts';
import { ComponentChecker } from './components.ts';
import {
  BOOL,
  containsTypeParam,
  inferTypeParams,
  substitute,
  type Type,
  type TypeParam,
} from './types.ts';

// Generic components on the server, `comp List<T>(items T[], render func(T) string)`: a use infers
// the type parameters from its properties, as a call does from its arguments, and the type of the
// tag has them. What the children give is inferred after, in ServerComponentChecker.

export abstract class ComponentGenericsChecker extends ComponentChecker {
  /** What the properties of the use being checked say about the type parameters. */
  private propBindings: Map<TypeParam, Type> | null = null;

  /** Function literals without types of parameters: checked last, as in a call. */
  private deferredProps: (() => void)[] = [];

  protected override checkComponentUse(node: ast.ElementExpression, tag: ast.Identifier): Type {
    const info = this.server ? this.lookupValue(tag.name)?.component : undefined;
    const generic =
      info !== undefined && [...info.props.values()].some((prop) => containsTypeParam(prop.type));
    const saved = { bindings: this.propBindings, deferred: this.deferredProps };

    // A use inside the value of a property has bindings of its own.
    this.propBindings = generic ? new Map() : null;
    this.deferredProps = [];
    try {
      const result = super.checkComponentUse(node, tag);

      for (const check of this.deferredProps) check();

      return this.propBindings ? substitute(result, this.propBindings) : result;
    } finally {
      this.propBindings = saved.bindings;
      this.deferredProps = saved.deferred;
    }
  }

  protected override checkProp(attribute: ast.JsxAttribute, type: Type, component: string): void {
    const bindings = this.propBindings;
    const { value } = attribute;

    if (!bindings || !containsTypeParam(type) || value?.kind === 'EventHandler') {
      super.checkProp(attribute, type, component);

      return;
    }

    // `render={n => String(n)}`: the type of `n` comes from the other properties.
    if (value?.kind === 'ArrowFunction' && value.params.some((param) => param.type === null)) {
      this.deferredProps.push(() => this.checkGenericProp(attribute, type, component, bindings));

      return;
    }

    this.checkGenericProp(attribute, type, component, bindings);
  }

  private checkGenericProp(
    attribute: ast.JsxAttribute,
    type: Type,
    component: string,
    bindings: Map<TypeParam, Type>,
  ): void {
    const { value } = attribute;

    if (value?.kind === 'EventHandler') return;

    const expected = substitute(type, bindings);
    // `[1, 2]` for `T[]` is checked on its own, and T is inferred from it.
    const open = containsTypeParam(expected) && value?.kind !== 'ArrowFunction';
    const valueType = value === null ? BOOL : this.checkValue(value, open ? null : expected);

    inferTypeParams(type, valueType, bindings);
    this.expectAssignable(
      valueType,
      substitute(type, bindings),
      value ?? attribute,
      ` for "${attribute.name.name}" of <${component}>`,
    );
  }
}
