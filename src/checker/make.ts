import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';
import { notDecoded } from './json.ts';
import { makeValue, type Made, type MakeContext } from './make-values.ts';
import { TopicChecker } from './topics.ts';
import {
  planTypeValues,
  type GenericCall,
  type TypeValues,
  type TypeValueUse,
} from './type-values.ts';
import {
  ANY,
  containsTypeParam,
  NUMBER,
  substitute,
  typedArrayOf,
  typeToString,
  UNKNOWN,
  type FunctionType,
  type Type,
  type TypeParam,
} from './types.ts';

// `make(File)`: the value of a type, computed when the program compiles (make-values.ts), and
// `make(float64[], n)`, a typed array of n zeros. In a generic function, `make(T)` and
// `decode<T>(x)` take the value of T from the calls, which may give it, `create<number>()`
// (type-values.ts).

export abstract class MakeChecker extends TopicChecker {
  /** The `func` that declares each of its type parameters. */
  private readonly owners = new Map<TypeParam, ast.FuncDeclaration>();
  private funcsByParams: WeakMap<readonly ast.TypeParameter[], ast.FuncDeclaration> | null = null;
  private readonly uses: TypeValueUse[] = [];
  private readonly genericCalls = new Map<ast.CallExpression, GenericCall>();
  private readonly givenTypes = new Map<ast.CallExpression, Type[]>();
  /** What the code generator writes for make(T) and decode<T>, once the module is checked. */
  protected typeValues: TypeValues = { functions: new Map(), params: new Map(), calls: new Map() };

  protected override createTypeParams(nodes: readonly ast.TypeParameter[]): TypeParam[] {
    const params = super.createTypeParams(nodes);
    const owner = nodes.length > 0 ? this.functionOf(nodes) : undefined;

    if (owner) for (const param of params) this.owners.set(param, owner);

    return params;
  }

  /** The `func` whose type parameters these are, if they are of one. */
  private functionOf(nodes: readonly ast.TypeParameter[]): ast.FuncDeclaration | undefined {
    if (!this.funcsByParams) {
      const functions = new WeakMap<readonly ast.TypeParameter[], ast.FuncDeclaration>();
      const visit = (node: ast.Node): void => {
        if (node.kind === 'FuncDeclaration') functions.set(node.typeParams, node);
        forEachChild(node, visit);
      };

      visit(this.program);
      this.funcsByParams = functions;
    }

    return this.funcsByParams.get(nodes);
  }

  protected override checkMake(node: ast.MakeExpression): Type {
    const type = this.resolveType(node.type);

    if (this.lookupValue('make')) {
      this.error(
        'make(...) makes the value of a type, so the name "make" is taken; rename the value, e.g. makeItem',
        node,
      );
    }

    if (node.length) {
      this.expectAssignable(this.checkValue(node.length, NUMBER), NUMBER, node.length);
      if (typedArrayOf(type) === null) {
        this.error(
          `make makes a typed array, e.g. make(float64[], n), not ${typeToString(type)}; a list starts empty and grows, e.g. let names string[] = []`,
          node.type,
        );
      }

      return type;
    }

    const made = makeValue(type, this.makeContext());

    if ('error' in made) {
      this.error(`cannot make ${typeToString(type)}: ${made.error}`, node.type);
    } else if (this.hasOwnedParams(type)) {
      this.uses.push({ kind: 'make', type });
    }

    return type;
  }

  /**
   * The type that decode checks against, with the type parameters of functions as any: their
   * types come from the calls, which are checked then.
   */
  protected decodedType(type: Type): Type {
    if (!this.hasOwnedParams(type)) return type;

    this.uses.push({ kind: 'decode', type });

    return substitute(type, new Map([...this.owners.keys()].map((param) => [param, ANY])));
  }

  private hasOwnedParams(type: Type): boolean {
    return this.owners.size > 0 && containsTypeParam(type, new Set(this.owners.keys()));
  }

  private makeContext(): MakeContext {
    return {
      param: (param) =>
        this.owners.has(param)
          ? { code: `$$${param.name}make()` }
          : {
              error: `${param.name} of a class or a method is not known when the program compiles; make(T) takes the type parameters of a func, e.g. func create<T>() T { return make(T) }`,
            },
      className: (info) => {
        const value = this.lookupValue(info.name)?.type;

        return value?.kind === 'classValue' && value.info === info ? info.name : null;
      },
    };
  }

  /** `create<number>()` gives T; each call of a generic function is kept for type-values.ts. */
  protected override checkArguments(
    signature: FunctionType,
    args: readonly (ast.Expression | ast.SpreadElement)[],
    node: ast.NodeBase,
    inferred = new Map<TypeParam, Type>(),
    expected: Type | null = null,
  ): Type[] {
    const call =
      'kind' in node && node.kind === 'CallExpression' ? (node as ast.CallExpression) : null;

    if (call?.typeArgs) this.giveTypeArgs(call, call.typeArgs, signature, inferred);

    const results = super.checkArguments(signature, args, node, inferred, expected);

    if (call && signature.typeParams.length > 0) {
      this.genericCalls.set(call, { node: call, signature, bindings: inferred });
    }

    return results;
  }

  private giveTypeArgs(
    call: ast.CallExpression,
    nodes: readonly ast.TypeNode[],
    signature: FunctionType,
    inferred: Map<TypeParam, Type>,
  ): void {
    // Overloads check the arguments again: the types are resolved once.
    let types = this.givenTypes.get(call);

    if (!types) {
      types = nodes.map((each) => this.resolveType(each));
      this.givenTypes.set(call, types);
    }

    if (types.length !== signature.typeParams.length) {
      this.error(
        signature.typeParams.length === 0
          ? 'the function takes no type arguments; leave them out'
          : `wrong number of type arguments: expected ${signature.typeParams.length}, got ${types.length}`,
        nodes[0]!,
      );
      // Not inferred instead: the error is enough.
      for (const param of signature.typeParams) inferred.set(param, UNKNOWN);

      return;
    }

    signature.typeParams.forEach((param, i) => inferred.set(param, types[i]!));
  }

  /** Once the module is checked: what each generic function takes, and the errors of the calls. */
  protected checkTypeValues(): void {
    const context = this.makeContext();

    this.typeValues = planTypeValues({
      program: this.program,
      owners: this.owners,
      uses: this.uses,
      calls: [...this.genericCalls.values()],
      types: this.checkedTypes,
      make: (type, param): Made => makeValue(type, { ...context, param }),
      notDecoded: (type) => notDecoded(type),
      error: (message, node) => this.error(message, node),
      warning: (message, node) => this.warnings.push({ message, start: node.start, end: node.end }),
    });

    // Other modules pass the values to the exported functions that take them.
    for (const [fn, plan] of this.typeValues.functions) {
      const type = fn.exported ? this.lookupValue(fn.name.name)?.type : undefined;

      if (plan.mode === 'params' && type?.kind === 'function') type.typeValues = plan.values;
    }
  }
}
