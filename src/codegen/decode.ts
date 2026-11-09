import type * as ast from '../ast.ts';
import { isText } from '../checker/json.ts';
import {
  containsTypeParam,
  memberNames,
  typeToString,
  type ObjectType,
  type Type,
  type TypeParam,
} from '../checker/types.ts';
import { TypeValueEmitter } from './type-values.ts';
import { ARROW } from './syntax.ts';

// `decode<User>(body)`: the type, which the checker found, becomes data that the runtime checks the
// value against (runtime/decode.js). An object type is a constant of the module, `$$typeUser`,
// written before its code (js.ts), so that types that refer to themselves or each other can do so,
// and the value of each call is only its name: `$$decodeJson(body, $$typeUser)`.

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export abstract class DecodeEmitter extends TypeValueEmitter {
  /** The constants of the object types that decode checks against, by type, in order. */
  private readonly decodeTypes = new Map<Type, { name: string; lines: string[] }>();
  /** Object types with what a function takes for T, being written, and whether they refer to themselves. */
  private readonly localTypes = new Map<Type, { name: string; used: boolean }>();
  private takenParams: Set<TypeParam> | null = null;

  /** `$$decodeJson(text, type)` for a string, `$$decode(value, type)` for a value from JS. */
  protected override decode(node: ast.DecodeExpression): string {
    const argument = this.expression(node.argument, ARROW);
    const result = this.options.types?.get(node);
    const type = result?.kind === 'tuple' ? result.types[0] : undefined;

    // Without the types of the checker nothing is checked (runtime/decode.js).
    if (type === undefined) return `$$decode(${argument}, null)`;

    const given = this.options.types?.get(node.argument);
    const decode = given !== undefined && isText(given) ? '$$decodeJson' : '$$decode';

    return `${decode}(${argument}, ${this.shape(this.concrete(type))})`;
  }

  /** The constants of the object types, for the start of the module. */
  protected decodeTypeLines(): string[] {
    return [...this.decodeTypes.values()].flatMap(({ lines }) => lines);
  }

  protected override typeShape(type: Type): string {
    return this.shape(type);
  }

  /** A type as runtime/decode.js has it: `"string"`, `{ array: "number" }`, `$$typeUser`. */
  private shape(type: Type): string {
    switch (type.kind) {
      // The type of the calls, or the one that the function takes (type-values.ts).
      case 'param': {
        const value = this.paramValue(type);

        if (!value) return '"any"';

        return value.kind === 'names' ? value.type : this.shape(value.type);
      }

      case 'number':
      case 'string':
      case 'bool':
      case 'any':
        return `"${type.kind}"`;

      case 'null':
        return '{ literal: [null] }';

      case 'literal':
        return `{ literal: [${JSON.stringify(type.value)}] }`;

      case 'nullable':
        return `{ nullable: ${this.shape(type.type)} }`;

      case 'array':
        return `{ array: ${this.shape(type.element)} }`;

      case 'union': {
        // The literals of a union are one list, as `"admin" | "user"` reads.
        const literals = type.types.flatMap((each) =>
          each.kind === 'literal' ? [each.value] : [],
        );
        const others = type.types.filter((each) => each.kind !== 'literal');
        const shapes = [
          ...(literals.length > 0 ? [`{ literal: [${literals.map(json).join(', ')}] }`] : []),
          ...others.map((each) => this.shape(each)),
        ];

        return shapes.length === 1 ? shapes[0]! : `{ union: [${shapes.join(', ')}] }`;
      }

      case 'object':
        return type.index && [...memberNames(type.members)].length === 0
          ? `{ record: ${this.shape(type.index)} }`
          : this.objectType(type);

      // The checker lets no other type through.
      default:
        return '"any"';
    }
  }

  /** The constant of an object type, made the first time it is used. */
  private objectType(type: ObjectType): string {
    if (this.takesTypes(type)) return this.localObjectType(type);

    const known = this.decodeTypes.get(type);

    if (known) return known.name;

    // `$$type` itself is the function of the runtime that makes them.
    const written = type.instanceOf?.template.name ?? type.name ?? 'Object';
    const base = `$$type${written.replace(/[^\w$]/g, '')}`;
    const taken = new Set([...this.decodeTypes.values()].map(({ name }) => name));
    let name = base;

    for (let i = 2; taken.has(name); i++) name = `${base}${i}`;

    const entry = { name, lines: [] as string[] };

    // Registered before its fields, which may refer to it.
    this.decodeTypes.set(type, entry);

    const fields = this.fields(type).map((field) => `  ${field},`);

    entry.lines =
      fields.length === 0
        ? [`const ${name} = $$type(${json(typeToString(type))}, () => ({}));`]
        : [`const ${name} = $$type(${json(typeToString(type))}, () => ({`, ...fields, '}));'];

    return name;
  }

  /** `name: "string"` for each field. */
  private fields(type: ObjectType): string[] {
    return [...memberNames(type.members)].flatMap((field) => {
      const member = type.members.get(field);
      const key = IDENTIFIER.test(field) ? field : json(field);

      return member ? [`${key}: ${this.shape(member.type)}`] : [];
    });
  }

  /** Whether the type has a type parameter whose type a function takes: then it is not a constant. */
  private takesTypes(type: Type): boolean {
    this.takenParams ??= new Set(
      [...(this.options.typeValues?.params ?? [])].flatMap(([param, value]) =>
        value.kind === 'names' ? [param] : [],
      ),
    );

    return this.takenParams.size > 0 && containsTypeParam(type, this.takenParams);
  }

  /**
   * `$$type("Box<T>", () => ({ value: $$Ttype }))`, written where it is used, since the type of T
   * is a parameter of the function. One that refers to itself is a constant of its own.
   */
  private localObjectType(type: ObjectType): string {
    const known = this.localTypes.get(type);

    if (known) {
      known.used = true;

      return known.name;
    }

    const entry = { name: `$$self${this.localTypes.size + 1}`, used: false };

    this.localTypes.set(type, entry);
    try {
      const made = `$$type(${json(typeToString(type))}, () => ({ ${this.fields(type).join(', ')} }))`;

      return entry.used
        ? `(() => { const ${entry.name} = ${made}; return ${entry.name}; })()`
        : made;
    } finally {
      this.localTypes.delete(type);
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
