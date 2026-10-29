import type * as ast from '../ast.ts';
import { placeOf } from './context.ts';
import { guardedByError, unpackedResults } from './error-results.ts';
import { isUntyped, countValues, callName, isCall } from './helpers.ts';
import { InitializerChecker } from './initializers.ts';
import {
  BOOL,
  ANY,
  isAssignable,
  isNullable,
  nonNull,
  nullable,
  typeToString,
  UNKNOWN,
  type Member,
  type Type,
} from './types.ts';

// Where values go: assignments to variables, fields and elements, and `return`. Both unpack a call
// that returns several values.

export abstract class AssignmentChecker extends InitializerChecker {
  /** The name of the `derived` whose block is being checked: it computes, so it changes no state. */
  protected derivedBlock: string | null = null;

  /**
   * `a, b = f()` or `return f()`: the call must return exactly `count` values. Returns their
   * types.
   */
  protected unpack(
    value: ast.Expression,
    count: number,
    declared: Type | null,
    context: 'assignment' | 'return' = 'assignment',
  ): Type[] {
    const type = this.checkExpression(value, null);

    if (type.kind === 'unknown') return Array<Type>(count).fill(UNKNOWN);

    // `v, ok = <-ch`: ok is false once the channel is closed and empty.
    if (count === 2 && value.kind === 'UnaryExpression' && value.operator === '<-') {
      if (declared) this.expectAssignable(type, declared, value);

      return declared ? [declared, BOOL] : [type, BOOL];
    }

    const returned = type.kind === 'tuple' ? type.types.length : type.kind === 'void' ? 0 : 1;

    if (type.kind !== 'tuple' || returned !== count) {
      const prefix =
        context === 'return'
          ? `wrong number of return values: expected ${count}, but`
          : `assignment mismatch: ${count} variables but`;

      this.error(`${prefix} ${callName(value)} returns ${countValues(returned)}`, value);

      return Array<Type>(count).fill(UNKNOWN);
    }

    // `return f()` passes the results on as they are; variables get the values before an error
    // as nullable (error-results.ts).
    const types = context === 'return' ? type.types : unpackedResults(type.types);

    if (declared) {
      for (const element of types) this.expectAssignable(element, declared, value);

      return types.map(() => declared);
    }

    return types;
  }

  protected checkAssignment(node: ast.AssignmentStatement): void {
    const { targets, values, operator } = node;

    if (operator !== '=') {
      const target = targets[0]!;
      const targetType = this.checkTarget(target);
      const valueType = this.checkValue(values[0]!, targetType);
      const result = this.binaryResult(
        operator.slice(0, -1) as ast.BinaryOperator,
        targetType,
        valueType,
        node,
      );

      this.expectAssignable(result, targetType, values[0]!);
      this.forget(target);

      return;
    }

    const targetTypes = targets.map((target) => this.checkTarget(target));
    let valueTypes: Type[];

    if (values.length === targets.length) {
      valueTypes = values.map((value, i) => {
        const type = this.checkValue(value, targetTypes[i] ?? null);

        this.expectAssignable(type, targetTypes[i]!, value);

        return type;
      });
    } else {
      valueTypes = this.unpack(values[0]!, targets.length, null);
      valueTypes.forEach((type, i) => this.expectAssignable(type, targetTypes[i]!, values[0]!));
    }

    targets.forEach((target, i) => {
      this.forget(target);

      const binding = this.narrowableBinding(target);
      const declared = binding?.type;

      if (binding && declared && isNullable(declared) && !isNullable(valueTypes[i] ?? UNKNOWN)) {
        this.flow.set(placeOf(binding), nonNull(declared));
      }
    });
  }

  /** The type a value assigned to `target` must have. */
  protected checkTarget(target: ast.Expression): Type {
    if (this.checkDecoratorWrite(target)) return UNKNOWN;
    switch (target.kind) {
      case 'Identifier': {
        if (target.name === '_') return ANY;

        const binding = this.lookupValue(target.name);

        if (!binding) {
          this.error(`"${target.name}" is not defined`, target);

          return UNKNOWN;
        }

        if (binding.kind === 'const') {
          this.error(`cannot assign to "${target.name}": it is a constant`, target);
        } else if (binding.kind === 'derived') {
          this.error(
            `cannot assign to "${target.name}": it is derived, so change what it is computed from`,
            target,
          );
        } else if (binding.kind === 'ref') {
          this.error(
            `cannot assign to "${target.name}": a ref always points to its element`,
            target,
          );
        } else if (binding.kind === 'state' && this.derivedBlock !== null) {
          this.error(
            `derived "${this.derivedBlock}" cannot change the state "${target.name}": change it in an event handler or an effect`,
            target,
          );
        } else if (binding.kind === 'loop') {
          this.error(`cannot assign to loop variable "${target.name}"`, target);
        } else if (binding.kind === 'prop') {
          this.error(
            this.decorator
              ? `cannot assign to "${target.name}": parameters of a decorator are read-only`
              : `cannot assign to "${target.name}": component properties are read-only; to change the parent's state, pass a function`,
            target,
          );
        } else if (
          binding.kind !== 'let' &&
          binding.kind !== 'state' &&
          binding.kind !== 'param' &&
          binding.kind !== 'catch'
        ) {
          this.error(`cannot assign to "${target.name}"`, target);
        }

        return binding.type ?? UNKNOWN;
      }

      case 'MemberExpression': {
        const object = this.nonNullValue(target.object);
        const member = this.findMember(object, target.property.name, target.property);

        if (member === 'any') return ANY;
        if (!member) return UNKNOWN;
        if (member.method) {
          this.error(`cannot assign to method "${target.property.name}"`, target);

          return UNKNOWN;
        }

        if (member.accessor === 'get') {
          this.error(
            `cannot assign to "${target.property.name}": it has a getter and no setter`,
            target,
          );
        } else if (member.readonly && !this.initializes(target, member)) {
          this.error(
            `cannot assign to "${target.property.name}": it is readonly, so only the constructor of ${member.owner?.name ?? 'its class'} assigns it`,
            target,
          );
        }

        return member.type;
      }

      case 'IndexExpression': {
        const object = this.nonNullValue(target.object);
        const keyed = this.keyedIndex(object, target.index);

        if (keyed) return keyed;
        this.expectIndex(target.index);
        if (object.kind === 'array') return object.element;
        if (object.kind === 'object' && object.numberIndex) return object.numberIndex;
        this.error(
          object.kind === 'string'
            ? 'cannot assign to a character: strings cannot be changed'
            : `cannot index ${typeToString(object)}`,
          target,
        );

        return UNKNOWN;
      }

      default:
        this.checkValue(target);

        return UNKNOWN;
    }
  }

  /** `this.id = id` in the constructor of the class that has the readonly field `id`. */
  private initializes(target: ast.MemberExpression, member: Member): boolean {
    return (
      target.object.kind === 'ThisExpression' &&
      this.fn?.isConstructor === true &&
      this.cls !== null &&
      !this.cls.isStatic &&
      this.cls.info === member.owner
    );
  }

  protected checkReturn(node: ast.ReturnStatement): void {
    const fn = this.fn;

    if (!fn) return;

    const { values } = node;

    if (fn.isComponent) {
      // A component may return early; whatever it returns is its markup.
      const [value] = values;

      if (value === undefined || values.length > 1) {
        this.error('a component returns its markup: "return <markup>"', node);

        return;
      }

      const type = this.checkValue(value);

      if (!isUntyped(type) && !isAssignable(type, this.dom.node)) {
        this.error(`a component returns markup, not ${typeToString(type)}`, value);
      }

      return;
    }

    if (fn.results === null) {
      // Results are inferred: just record what is returned.
      if (values.length === 1) {
        const type = this.checkExpression(values[0]!, null);

        fn.returns.push(type.kind === 'tuple' ? type.types : type.kind === 'void' ? [] : [type]);
      } else {
        fn.returns.push(values.map((value) => this.checkValue(value)));
      }

      return;
    }

    const expected = fn.results;

    if (values.length === 0) {
      if (expected.length > 0) {
        this.error(`missing return values: expected ${countValues(expected.length)}`, node);
      }

      return;
    }

    if (expected.length === 0) {
      this.error('too many return values: this function returns nothing', values[0]!);
      for (const value of values) this.checkExpression(value, null);

      return;
    }

    if (values.length === 1 && expected.length > 1 && isCall(values[0]!)) {
      const types = this.unpack(values[0]!, expected.length, null, 'return');

      types.forEach((type, i) =>
        this.expectAssignable(type, expected[i]!, values[0]!, ' in return'),
      );

      return;
    }

    if (values.length !== expected.length) {
      this.error(
        `wrong number of return values: expected ${expected.length}, got ${values.length}`,
        node,
      );
    }

    const types = values.map((value, i) => this.checkValue(value, expected[i] ?? null));

    types.forEach((type, i) => {
      const target = expected[i];

      if (!target) return;
      if (type.kind === 'null' && this.nullWithError(expected, types, values, i)) return;
      this.expectAssignable(type, target, values[i]!, ' in return');
    });
  }

  /**
   * `return null, err` in a function of `(User, error)`: null takes the place of a value only
   * together with an error that is not null. Returns whether the null is checked here.
   */
  private nullWithError(
    expected: readonly Type[],
    types: readonly Type[],
    values: readonly ast.Expression[],
    i: number,
  ): boolean {
    const last = expected.length - 1;

    if (!guardedByError(expected).includes(i) || types.length !== expected.length) return false;

    const error = types[last]!;
    const target = typeToString(expected[i]!);

    if (error.kind === 'null') {
      this.error(
        `cannot return null with no error: make the result ${typeToString(nullable(expected[i]!))} if the value may be null without an error`,
        values[i]!,
      );
    } else if (isNullable(error)) {
      const name = values[last]!.kind === 'Identifier' ? values[last].name : 'err';

      this.error(
        `null in place of ${target} needs an error that is not null: check it first, e.g. if ${name} != null { return null, ${name} }`,
        values[i]!,
      );
    }

    return true;
  }
}
