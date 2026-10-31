import type * as ast from '../ast.ts';
import { attrsParam } from '../attrs.ts';
import { ARRAY_MUTATORS } from '../methods.ts';
import type { ComponentInfo } from './context.ts';
import { ForwardingChecker } from './forwarding.ts';
import { isUntyped } from './helpers.ts';
import { isAssignable, nonNull, typeToString, UNKNOWN, type Type } from './types.ts';

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

    const type = this.bindTarget(value, name);

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

  /**
   * The variable that `bind:` writes into. The item of `for row in rows` is one too: the component
   * changes it in place, and a new value replaces it in `rows`, which must be a variable or a field.
   */
  private bindTarget(value: ast.Expression, name: string): Type {
    const binding = value.kind === 'Identifier' ? this.lookupValue(value.name) : undefined;

    if (binding?.kind !== 'loop' || value.kind !== 'Identifier') return this.checkTarget(value);

    const list = binding.iterable;

    if (list?.kind !== 'Identifier' && list?.kind !== 'MemberExpression') {
      this.error(
        `"bind:${name}" of "${value.name}" needs a loop over a list in a variable or a field, e.g. for ${value.name} in items`,
        value,
      );

      return this.checkValue(value);
    }

    // Written as `rows[i] = value`, so `rows` must be one that can be changed here.
    const at = { start: value.start, end: value.end };

    this.checkTarget({
      kind: 'IndexExpression',
      object: list,
      index: { kind: 'NumberLiteral', value: 0, raw: '0', ...at },
      optional: false,
      start: value.start,
      end: value.end,
    });

    return this.checkValue(value);
  }

  /**
   * `row.name = "x"` or `bind:value={row.name}` where `row` is a property that is not bound: the
   * object is the parent's, which would change without its markup knowing.
   */
  protected override checkPropWrite(target: ast.Expression): void {
    if (target.kind === 'MemberExpression' || target.kind === 'IndexExpression') {
      this.propChanged(target.object, target);
    }
  }

  /**
   * `items.push(x)` or `seen.add(id)` where the property is not bound. Other methods are not
   * reported: a method of a class or a function in a field may change nothing.
   */
  protected checkPropMutation(node: ast.CallExpression): void {
    const { callee } = node;

    if (callee.kind !== 'MemberExpression') return;

    const object = nonNull(this.typeOfChecked(callee.object) ?? UNKNOWN);
    const name = callee.property.name;
    const collection =
      object.kind === 'object' ? (object.instanceOf?.template.name ?? object.name) : null;
    const changes =
      object.kind === 'array'
        ? ARRAY_MUTATORS.has(name)
        : (collection === 'Map' || collection === 'Set') && COLLECTION_MUTATORS.has(name);

    if (changes) this.propChanged(callee.object, node);
  }

  private propChanged(object: ast.Expression, node: ast.NodeBase): void {
    let root = object;

    while (root.kind === 'MemberExpression' || root.kind === 'IndexExpression') root = root.object;
    if (root.kind !== 'Identifier' || !this.component || this.decorator) return;
    if (this.lookupValue(root.name)?.kind !== 'prop') return;
    this.error(
      `"${root.name}" is a property: changing it in place would not update the parent; declare it bound, e.g. comp ${this.component.node.name.name}(bind ${root.name} ...), and pass bind:${root.name}={...}`,
      node,
    );
  }
}

const COLLECTION_MUTATORS: ReadonlySet<string> = new Set(['set', 'add', 'delete', 'clear']);
