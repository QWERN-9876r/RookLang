import type * as ast from '../ast.ts';
import { attrsParam } from '../attrs.ts';
import type { ComponentInfo } from './context.ts';
import { ForwardingChecker } from './forwarding.ts';
import { isUntyped } from './helpers.ts';
import { isAssignable, typeToString } from './types.ts';

// Bound properties: `comp Tabs(bind active string)` may change `active`, and
// `<Tabs bind:active={tab} />` writes those changes into the parent's `tab`, as `bind:value` of an
// input does. The value goes both ways, so the variable and the property have the same type.

export abstract class ComponentBindingChecker extends ForwardingChecker {
  /** `bind:active={tab}` on a component; adds the name of the property to `given`. */
  protected checkPropBinding(
    attribute: ast.JsxAttribute,
    info: ComponentInfo,
    component: string,
    given: Set<string>,
  ): void {
    const name = attribute.name.name.slice('bind:'.length);
    const prop = info.props.get(name);
    const { value } = attribute;

    if (given.has(name)) this.error(`duplicate property "${name}"`, attribute.name);
    given.add(name);
    if (!prop) {
      this.error(
        attrsParam(info.node)
          ? `${attribute.name.name} does not go through the attributes of <${component}>`
          : `<${component}> has no property "${name}" to bind`,
        attribute.name,
      );
    } else if (!prop.bind) {
      this.error(
        `"${name}" of <${component}> is not bound: the component declares it with bind to change it, e.g. comp ${component}(bind ${name} ...)`,
        attribute.name,
      );
    }

    if (value === null || value.kind === 'StringLiteral' || value.kind === 'EventHandler') {
      this.error(
        `"bind:${name}" needs a variable in braces, e.g. bind:${name}={${name}}`,
        attribute,
      );

      return;
    }

    const bindable =
      (value.kind === 'Identifier' && value.name !== '_') ||
      ((value.kind === 'MemberExpression' || value.kind === 'IndexExpression') && !value.optional);

    if (!bindable) {
      this.checkValue(value);
      this.error(`"bind:${name}" needs a variable or a field to write to`, value);

      return;
    }

    const type = this.checkTarget(value);

    this.checkedTypes.set(value, type);
    if (!prop?.bind || isUntyped(type) || isUntyped(prop.type)) return;
    // The parent gives its value, and the component writes its own back.
    if (!isAssignable(type, prop.type) || !isAssignable(prop.type, type)) {
      this.error(
        `cannot bind ${typeToString(type)} to "${name}" of <${component}>, which is ${typeToString(prop.type)}`,
        value,
      );
    }
  }
}
