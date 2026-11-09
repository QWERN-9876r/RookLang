import type * as ast from '../ast.ts';
import { factory, makeValue, type Made, type MakeContext } from '../checker/make-values.ts';
import type { ParamValue } from '../checker/type-values.ts';
import {
  containsTypeParam,
  substitute,
  type Type,
  type TypeParam,
  type TypeValue,
} from '../checker/types.ts';
import { CallEmitter } from './calls.ts';

// `make(File)` is the value the checker computed for the type, `{ name: "", size: 0 }`. In a
// generic function, `make(T)` and `decode<T>` are what the checker planned (checker/type-values.ts):
// the value of the one type it is called with, or what it takes before its own parameters, a
// function that makes the value and the type that decode checks against:
//
//     func create<T>() T { return make(T) }         function create($$Tmake) {
//     const n = create<number>()                       return $$Tmake();
//     const s = create<string>()                     }
//                                                    const n = create(() => 0);
//                                                    const s = create(() => "");

export abstract class TypeValueEmitter extends CallEmitter {
  protected override make(node: ast.MakeExpression): string {
    if (node.length) return super.make(node);

    const type = this.options.types?.get(node);

    // Without the checker only what the type shows as written is known.
    if (!type) return this.zeroValue(node.type) ?? 'undefined';

    return code(makeValue(type, this.makeContext()));
  }

  private makeContext(): MakeContext {
    return {
      param: (param) => {
        const value = this.paramValue(param);

        if (!value) return { code: 'undefined' };

        return value.kind === 'names'
          ? { code: `${value.make}()` }
          : makeValue(value.type, this.makeContext());
      },
      className: (info) => this.name(info.name),
    };
  }

  /** The type with the one type of each function called with one: `Box<string>` of `Box<T>`. */
  protected concrete(type: Type): Type {
    const params = this.options.typeValues?.params ?? new Map<TypeParam, ParamValue>();
    const bindings = new Map(
      [...params].flatMap(([param, value]) =>
        value.kind === 'type' ? [[param, value.type] as const] : [],
      ),
    );

    return bindings.size > 0 && containsTypeParam(type, new Set(bindings.keys()))
      ? substitute(type, bindings)
      : type;
  }

  /** What a type parameter of make and decode is here: a type, or the names of its values. */
  protected paramValue(param: TypeParam): ParamValue | undefined {
    return this.options.typeValues?.params.get(param);
  }

  /** `create(() => 0, n)`: the values that the function takes, before the arguments. */
  protected override withTypeValues(node: ast.CallExpression, args: string): string {
    const call = this.options.typeValues?.calls.get(node);

    if (!call) return args;

    const values = call.values.map((value) =>
      this.typeValue(value, call.bindings.get(value.param)),
    );

    return [...values, ...(args === '' ? [] : [args])].join(', ');
  }

  private typeValue(value: TypeValue, type: Type | undefined): string {
    if (!type) return 'undefined';

    // A type parameter that is passed on is passed as it is: `create($$Tmake)`.
    const given = type.kind === 'param' ? this.paramValue(type) : undefined;

    if (given?.kind === 'names') return value.kind === 'make' ? given.make : given.type;
    if (value.kind === 'decode') return this.typeShape(type);

    return factory(code(makeValue(type, this.makeContext())));
  }

  /** The type that decode checks against, as decode.ts writes it. */
  protected abstract typeShape(type: Type): string;

  /** The parameters of a function, with the values it takes before them. */
  protected typeValueParams(node: ast.FuncDeclaration): ast.Parameter[] {
    const plan = this.options.typeValues?.functions.get(node);

    if (plan?.mode !== 'params') return node.params;

    const names = plan.values.map(({ param, kind }) => {
      const value = this.paramValue(param);

      return value?.kind === 'names' ? (kind === 'make' ? value.make : value.type) : param.name;
    });
    const at = { start: node.name.start, end: node.name.end };

    return [
      ...names.map((name): ast.Parameter => ({
        kind: 'Parameter',
        name: { kind: 'Identifier', name, ...at },
        type: null,
        defaultValue: null,
        ...at,
      })),
      ...node.params,
    ];
  }

  /** A generic function that is never called: what make(T) is in it cannot be known. */
  protected isLeftOut(node: ast.FuncDeclaration): boolean {
    return this.options.typeValues?.functions.get(node)?.mode === 'removed';
  }
}

function code(made: Made): string {
  return 'code' in made ? made.code : 'undefined';
}
