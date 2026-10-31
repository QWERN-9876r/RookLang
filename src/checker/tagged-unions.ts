import type * as ast from '../ast.ts';
import { placeOf, type Narrowing, type Place } from './context.ts';
import { ControlFlowChecker } from './control-flow.ts';
import { literalValue, narrowByTag } from './flow.ts';
import { callSignature } from './helpers.ts';
import {
  findClassMember,
  memberTypeOf,
  nonNull,
  typesEqual,
  typeToString,
  unionMembers,
  UNKNOWN,
  type LiteralType,
  type Member,
  type Type,
} from './types.ts';

// Paths and tagged unions. A path of data fields from a variable, `order.delivery`, is narrowed
// like the variable itself. A tag is a field with literal types in every member of a union,
// `kind "pickup"`: comparing it narrows the union, and an object literal chooses its member by it.

type Value = LiteralType['value'];

export abstract class TaggedUnionChecker extends ControlFlowChecker {
  /** The paths among the checked member expressions, with the types of their fields. */
  private readonly paths = new WeakMap<ast.MemberExpression, { place: Place; type: Type }>();

  /** The types of the fields of the paths, before narrowing: what their tags are found in. */
  private readonly declared = new WeakMap<Place, Type>();

  protected override isTagOf(place: Place, field: string): boolean {
    const type = place.path === '' ? place.binding.type : this.declared.get(place);

    return type != null && this.tagValues(unionMembers(nonNull(type)), field) !== null;
  }

  protected override narrowable(node: ast.Expression): { place: Place; type: Type } | undefined {
    if (node.kind === 'Identifier') {
      const binding = this.narrowableBinding(node);

      if (!binding?.type) return undefined;

      const place = placeOf(binding);

      return { place, type: this.flow.get(place) ?? binding.type };
    }

    const path = node.kind === 'MemberExpression' ? this.paths.get(node) : undefined;

    return path && { place: path.place, type: this.flow.get(path.place) ?? path.type };
  }

  /**
   * The type of `object.field` read by `node`, which is `type` unless the expression is a path
   * narrowed here. Getters and methods are not paths: they may give another value each time.
   */
  protected pathType(node: ast.MemberExpression, object: Type, type: Type): Type {
    const parent = node.optional ? undefined : this.narrowable(node.object)?.place;
    const { name } = node.property;

    if (!parent || !unionMembers(object).every((member) => this.dataField(member, name))) {
      this.paths.delete(node);

      return type;
    }

    const place = placeOf(parent.binding, parent.path === '' ? name : `${parent.path}.${name}`);

    this.paths.set(node, { place, type });
    this.declared.set(place, type);

    return this.flow.get(place) ?? type;
  }

  /** The field `name` of an object or a class instance, unless it is a method or an accessor. */
  protected dataField(type: Type, name: string): Member | undefined {
    let member: Member | undefined;

    if (type.kind === 'object') {
      member = type.members.get(name);
    } else if (type.kind === 'class') {
      this.ensureClassResolved(type.info);
      member = findClassMember(type.info, name, false);
      if (member && type.args) member = { ...member, type: memberTypeOf(type, member) };
    }

    return member && !member.method && member.accessor === undefined ? member : undefined;
  }

  /** The values of the tag `name` in each member of a union; `null` when `name` is not a tag. */
  protected tagValues(members: readonly Type[], name: string): Value[][] | null {
    if (members.length < 2) return null;

    const tags: Value[][] = [];

    for (const member of members) {
      const field = this.dataField(member, name);
      const types = field ? unionMembers(field.type) : [];

      if (!types.every((type): type is LiteralType => type.kind === 'literal')) return null;
      if (types.length === 0) return null;
      tags.push(types.map((type) => type.value));
    }

    return tags;
  }

  /** `d.kind == "courier"` narrows `d` too: the members with this tag, or the others. */
  protected override narrow(node: ast.Expression, assumeTrue: boolean): Narrowing {
    const narrowing = super.narrow(node, assumeTrue);

    if (node.kind !== 'BinaryExpression') return narrowing;
    if (node.operator !== '==' && node.operator !== '!=') return narrowing;

    const right = literalValue(node.right);
    const value = right ?? literalValue(node.left);

    if (value === undefined) return narrowing;

    const target = right !== undefined ? node.left : node.right;
    const equal = (node.operator === '==') === assumeTrue;

    return [...narrowing, ...this.narrowTag(target, [value], equal)];
  }

  /** `switch d.kind`: in a case the members with its tags, in `default` those of no case. */
  protected override narrowCase(node: ast.SwitchStatement, switchCase: ast.SwitchCase): Narrowing {
    const narrowing = super.narrowCase(node, switchCase);

    if (!node.discriminant) return narrowing;

    const isDefault = switchCase.tests.length === 0;
    const tests = isDefault ? node.cases.flatMap((each) => each.tests) : switchCase.tests;
    const values = tests.map(literalValue);

    if (!isDefault && values.includes(undefined)) return narrowing;

    const known = values.filter((value) => value !== undefined);

    return [...narrowing, ...this.narrowTag(node.discriminant, known, !isDefault)];
  }

  private narrowTag(target: ast.Expression, values: readonly Value[], equal: boolean): Narrowing {
    if (target.kind !== 'MemberExpression' || target.optional) return [];

    const owner = this.narrowable(target.object);
    const tags = owner && this.tagValues(unionMembers(nonNull(owner.type)), target.property.name);

    return owner && tags ? [[owner.place, narrowByTag(owner.type, tags, values, equal)]] : [];
  }

  /**
   * The type of a field in the objects of a union that no tag chooses from, when it is the same in
   * each that has it: the literal takes it from the context, as `fetch: req => ...` of the options
   * of `Bun.serve`. Functions only need the same parameters, which is what their literals take.
   */
  protected commonField(objects: readonly Type[], name: string): Type | null {
    const types = objects.flatMap((object) => {
      const member =
        object.kind === 'object'
          ? object.members.get(name)
          : object.kind === 'class'
            ? findClassMember(object.info, name, false)
            : undefined;

      return member ? [member.type] : [];
    });
    const [first] = types;

    if (!first) return null;
    if (types.every((type) => typesEqual(type, first))) return first;

    const signature = callSignature(nonNull(first));
    const sameParams = types.every((type) => {
      const other = callSignature(nonNull(type));

      return (
        signature &&
        other &&
        other.params.length === signature.params.length &&
        other.params.every((param, i) => typesEqual(param, signature.params[i]!))
      );
    });

    return sameParams ? first : null;
  }

  /**
   * `{ kind: "pickup", shop: "Main st." }` where one of several objects is expected: the member
   * that a tag of the literal chooses, or `null` when no tag chooses one. A tag of no member is
   * reported, and the literal then gets `UNKNOWN`, so that it is not reported again.
   */
  protected taggedMember(
    node: ast.ObjectLiteral,
    objects: readonly Type[],
    union: Type,
  ): Type | null {
    for (const property of node.properties) {
      if (property.kind === 'SpreadElement') continue;

      const name = property.key.kind === 'Identifier' ? property.key.name : property.key.value;
      const value = literalValue(property.value);
      const tags = value === undefined ? null : this.tagValues(objects, name);

      if (value === undefined || !tags) continue;

      const chosen = objects.filter((_, i) => tags[i]!.includes(value));

      if (chosen.length === 1) return chosen[0]!;
      if (chosen.length > 1) continue;

      const known = [...new Set(tags.flat())].map((each) => JSON.stringify(each));
      const choices =
        known.length > 1 ? `${known.slice(0, -1).join(', ')} or ${known.at(-1)!}` : known[0]!;

      this.error(
        `${JSON.stringify(value)} is not a kind of ${typeToString(union)}: write ${choices}`,
        property.value,
      );

      return UNKNOWN;
    }

    return null;
  }
}
