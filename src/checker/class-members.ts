import type * as ast from '../ast.ts';
import { DeclarationChecker } from './declarations.ts';
import { notCopied } from './transfer.ts';
import {
  findClassMember,
  isAssignable,
  typeToString,
  UNKNOWN,
  type ClassInfo,
  type FunctionType,
  type Member,
} from './types.ts';

// The members of classes that are more than a field or a method: getters and setters, the
// properties of constructor parameters, abstract methods; ClassChecker declares and checks them.

export abstract class ClassMemberChecker extends DeclarationChecker {
  /** The signatures of getters and setters: their members have the type of the value. */
  protected readonly accessorSignatures = new Map<ast.MethodDeclaration, FunctionType>();

  protected declareMember(
    info: ClassInfo,
    isStatic: boolean,
    name: ast.Identifier,
    member: Member,
  ): void {
    const members = isStatic ? info.statics : info.members;

    if (members.has(name.name)) this.error(`duplicate member "${name.name}"`, name);
    members.set(name.name, member);
  }

  /** `get area() number` and `set area(v number)` make one member, of the type of the value. */
  protected declareAccessor(
    info: ClassInfo,
    node: ast.MethodDeclaration,
    accessor: 'get' | 'set',
  ): void {
    const signature = this.signature(node.params, node.results);
    const type = (accessor === 'get' ? signature.results[0] : signature.params[0]) ?? UNKNOWN;
    const members = node.isStatic ? info.statics : info.members;
    const other = members.get(node.name.name);

    this.accessorSignatures.set(node, signature);
    if (
      other?.owner === info &&
      (other.accessor === 'get' || other.accessor === 'set') &&
      other.accessor !== accessor
    ) {
      const [getter, setter] = accessor === 'get' ? [type, other.type] : [other.type, type];

      if (!isAssignable(getter, setter) || !isAssignable(setter, getter)) {
        this.error(
          `the getter and the setter of "${node.name.name}" have different types: ` +
            `${typeToString(getter)} and ${typeToString(setter)}`,
          node.name,
        );
      }

      members.set(node.name.name, { ...other, type: getter, accessor: 'both' });

      return;
    }

    this.declareMember(info, node.isStatic, node.name, {
      type,
      method: false,
      visibility: node.visibility,
      owner: info,
      accessor,
      ...(node.abstract ? { abstract: true } : {}),
    });
  }

  /** `constructor(private name string)`: the parameters that are properties of the class too. */
  protected declareParamProperties(
    node: ast.ConstructorDeclaration,
    info: ClassInfo,
    ctor: FunctionType,
  ): void {
    node.params.forEach((param, i) => {
      if (!param.property) return;

      const type = ctor.params[i] ?? UNKNOWN;
      const reason = info.data === true ? notCopied(type) : null;

      if (reason !== null) {
        this.error(
          `the fields of a data class go to other threads as copies: ${reason}`,
          param.type ?? param.name,
        );
      }

      this.declareMember(info, false, param.name, {
        type,
        method: false,
        visibility: param.property.visibility,
        owner: info,
        ...(param.property.readonly ? { readonly: true } : {}),
      });
    });
  }

  /**
   * Only an abstract class has abstract methods, and a class that is not abstract implements
   * those of its bases.
   */
  protected checkAbstract(node: ast.ClassDeclaration, info: ClassInfo): void {
    if (node.abstract) return;

    for (const member of node.members) {
      if (member.kind !== 'MethodDeclaration' || !member.abstract) continue;
      this.error(
        `"${member.name.name}" is abstract, so its class must be too: abstract class ${info.name}`,
        member.name,
      );
    }

    const missing = new Set<string>();

    for (let base = info.superClass; base; base = base.superClass) {
      for (const [name, member] of base.members) {
        const found = member.abstract ? findClassMember(info, name, false) : undefined;

        if (found?.abstract) missing.add(`${found.owner?.name ?? base.name}.${name}`);
      }
    }

    if (missing.size === 0) return;
    this.error(
      `class "${info.name}" does not implement ${[...missing].join(', ')}: implement ` +
        `${missing.size === 1 ? 'it' : 'them'} or make the class abstract, e.g. abstract class ${info.name}`,
      node.name,
    );
  }

  /**
   * In JS a field is set on each instance and so hides a getter or setter of the prototype: a
   * field and an accessor of the same name in a class and its base would not work together.
   */
  protected checkAccessorOverride(info: ClassInfo, name: ast.Identifier, isStatic: boolean): void {
    const own = (isStatic ? info.statics : info.members).get(name.name);
    const base = info.superClass && findClassMember(info.superClass, name.name, isStatic);

    // Only the classes of Rook have `data` set: lib.dom declares many accessors as fields.
    if (!own || !base || own.method || base.method || base.owner?.data === undefined) return;
    if (own.accessor && !base.accessor) {
      this.error(
        `"${name.name}" is a field in ${base.owner.name}, which would hide a getter or setter ` +
          'here: the field is set on each instance; override it with a field',
        name,
      );
    } else if (!own.accessor && base.accessor) {
      this.error(
        `"${name.name}" is a getter or setter in ${base.owner.name}, which a field here would ` +
          'hide: override it with a getter or setter',
        name,
      );
    }
  }
}
