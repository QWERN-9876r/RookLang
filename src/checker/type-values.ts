import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';
import type { Made } from './make-values.ts';
import {
  ANY,
  containsTypeParam,
  substitute,
  typeToString,
  type FunctionType,
  type Type,
  type TypeParam,
  type TypeValue,
} from './types.ts';

// `make(T)` and `decode<T>(x)` in a generic function: the types are erased, so the value of T
// comes from the calls (docs/spec.md, "make"). Each function whose body
// needs them is one of three:
//   - called with one type: the value is written into its body, `return 0`;
//   - called with several, or exported: it takes them before its own parameters, a function that
//     makes the value, `create(() => 0)`, and the type that decode checks against;
//   - never called: it is left out of the JS, with a warning, since nothing says what T is.
// What a function needs, it needs for the calls in it too: `func pair<T>() { create<T>() }`.

/** A `make(T)` or `decode<T>` in a body, with the type as written there. */
export interface TypeValueUse {
  kind: TypeValue['kind'];
  type: Type;
}

/** A call of a generic function, with the type arguments it gives. */
export interface GenericCall {
  node: ast.CallExpression;
  signature: FunctionType;
  bindings: ReadonlyMap<TypeParam, Type>;
}

export type FunctionPlan =
  { mode: 'removed' } | { mode: 'inline' } | { mode: 'params'; values: readonly TypeValue[] };

/** What the type parameters that make and decode use are in the code. */
export type ParamValue =
  { kind: 'type'; type: Type } | { kind: 'names'; make: string; type: string };

/** What the code generator writes for the type parameters of make and decode. */
export interface TypeValues {
  functions: Map<ast.FuncDeclaration, FunctionPlan>;
  params: Map<TypeParam, ParamValue>;
  /** The calls that pass values to the function, `create(() => 0)`. */
  calls: Map<
    ast.CallExpression,
    { values: readonly TypeValue[]; bindings: ReadonlyMap<TypeParam, Type> }
  >;
}

export interface TypeValueInput {
  program: ast.Program;
  owners: ReadonlyMap<TypeParam, ast.FuncDeclaration>;
  uses: readonly TypeValueUse[];
  calls: readonly GenericCall[];
  types: WeakMap<ast.Expression, Type>;
  /** make() of a type, with what each type parameter gives. */
  make(type: Type, param: (param: TypeParam) => Made): Made;
  /** Why decode cannot take the type, or null. */
  notDecoded(type: Type): string | null;
  error(message: string, node: ast.NodeBase): void;
  warning(message: string, node: ast.NodeBase): void;
}

/** More instances than this, as of `func f<T>() { f<T[]>() }`, are passed as values. */
const MAX_INSTANCES = 16;

export function typeValueNames(param: TypeParam): { make: string; type: string } {
  return { make: `$$${param.name}make`, type: `$$${param.name}type` };
}

export function planTypeValues(input: TypeValueInput): TypeValues {
  return new Planner(input).plan();
}

class Planner {
  private readonly needs = new Map<ast.FuncDeclaration, TypeValue[]>();
  /** The functions around each call. */
  private readonly around = new Map<ast.CallExpression, ast.FuncDeclaration[]>();
  /** Functions used as values, not called: `const f = create`. */
  private readonly functionValues: ast.Identifier[] = [];
  private readonly input: TypeValueInput;

  constructor(input: TypeValueInput) {
    this.input = input;
  }

  plan(): TypeValues {
    const { input } = this;

    this.walk(input.program, []);
    for (const use of input.uses) {
      for (const param of this.usedParams(use.type, use.kind)) this.need(param, use.kind);
    }

    // What a call needs, the function around it needs for the type arguments it gives.
    for (let changed = true; changed;) {
      changed = false;
      for (const call of input.calls) {
        for (const value of this.valuesOf(call.signature)) {
          const given = call.bindings.get(value.param);

          if (!given) continue;
          for (const param of this.usedParams(given, value.kind)) {
            changed = this.need(param, value.kind) || changed;
          }
        }
      }
    }

    this.checkCalls();
    for (const node of this.functionValues) {
      const values = this.valuesOf(this.input.types.get(node) as FunctionType);

      if (values.length > 0) {
        input.error(
          `"${node.name}" cannot be used as a value: ${this.describe(values)} in it needs the ${values[0]!.param.name} of each call; call it, e.g. () => ${node.name}<number>()`,
          node,
        );
      }
    }

    const instances = this.instances();
    const result: TypeValues = { functions: new Map(), params: new Map(), calls: new Map() };

    for (const [fn, values] of this.needs) {
      const found = instances.get(fn)!;

      if (found === 'open' || found.size > 1) {
        result.functions.set(fn, { mode: 'params', values });
        for (const { param } of values) {
          result.params.set(param, { kind: 'names', ...typeValueNames(param) });
        }
      } else if (found.size === 1) {
        const [bindings] = found.values();

        result.functions.set(fn, { mode: 'inline' });
        for (const { param } of values) {
          result.params.set(param, { kind: 'type', type: bindings!.get(param) ?? ANY });
        }
      } else {
        result.functions.set(fn, { mode: 'removed' });
        input.warning(
          `"${fn.name.name}" is never called, so it is left out of the JS: ${this.describe(values)} needs the ${values[0]!.param.name} of a call; call it, e.g. ${fn.name.name}<number>(), or remove it`,
          fn.name,
        );
      }
    }

    for (const call of input.calls) {
      const values = this.valuesOf(call.signature);
      const fn = this.declarationOf(call.signature);
      const mode = fn ? result.functions.get(fn)?.mode : 'params';

      if (values.length > 0 && mode === 'params') {
        result.calls.set(call.node, { values, bindings: call.bindings });
      }
    }

    return result;
  }

  /** Finds the functions around calls, and functions used as values. */
  private walk(node: ast.Node, around: ast.FuncDeclaration[]): void {
    if (node.kind === 'CallExpression') {
      this.around.set(node, around);
      // The callee is called, not used as a value; its own parts are walked.
      if (node.callee.kind !== 'Identifier') this.walk(node.callee, around);
      node.typeArgs?.forEach((each) => this.walk(each, around));
      node.arguments.forEach((each) => this.walk(each, around));

      return;
    }

    if (node.kind === 'Identifier') {
      if (this.input.types.get(node)?.kind === 'function') this.functionValues.push(node);

      return;
    }

    const inner = node.kind === 'FuncDeclaration' ? [...around, node] : around;

    forEachChild(node, (child) => this.walk(child, inner));
  }

  /** `make(T)`, `decode<T>` or both, for messages. */
  private describe(values: readonly TypeValue[]): string {
    const { name } = values[0]!.param;
    const kinds = new Set(values.map((value) => value.kind));

    return [...kinds]
      .map((kind) => (kind === 'make' ? `make(${name})` : `decode<${name}>`))
      .join(' and ');
  }

  /** What a function takes for its type parameters: found here, or by the module it is from. */
  private valuesOf(signature: FunctionType): readonly TypeValue[] {
    const fn = this.declarationOf(signature);

    return fn ? (this.needs.get(fn) ?? []) : (signature.typeValues ?? []);
  }

  private declarationOf(signature: FunctionType): ast.FuncDeclaration | undefined {
    const [first] = signature.typeParams;

    return first ? this.input.owners.get(first) : undefined;
  }

  /** Adds what a function needs; gives whether it is new. */
  private need(param: TypeParam, kind: TypeValue['kind']): boolean {
    const fn = this.input.owners.get(param);

    if (!fn) return false;

    const values = this.needs.get(fn) ?? [];

    if (values.some((value) => value.param === param && value.kind === kind)) return false;

    // In the order of the type parameters, make before decode.
    const order = (value: TypeValue) =>
      fn.typeParams.findIndex((each) => each.name.name === value.param.name) * 2 +
      (value.kind === 'make' ? 0 : 1);

    values.push({ param, kind });
    values.sort((a, b) => order(a) - order(b));
    this.needs.set(fn, values);

    return true;
  }

  /** The type parameters of functions whose values `make` or `decode` of the type takes. */
  private usedParams(type: Type, kind: TypeValue['kind']): TypeParam[] {
    const owned = [...this.input.owners.keys()];

    if (kind === 'decode')
      return owned.filter((param) => containsTypeParam(type, new Set([param])));

    const used: TypeParam[] = [];

    this.input.make(type, (param) => {
      used.push(param);

      return { code: '0' };
    });

    return used.filter((param) => this.input.owners.has(param));
  }

  /** Each call that needs values gives its type arguments, and they have values. */
  private checkCalls(): void {
    const { input } = this;

    for (const call of input.calls) {
      const name = calleeName(call.node);

      for (const value of this.valuesOf(call.signature)) {
        const given = call.bindings.get(value.param);
        const param = value.param.name;

        // Unknown after an error that is reported already.
        if (given?.kind === 'unknown') continue;
        if (!given) {
          input.error(
            `cannot infer ${param} of ${name}: give it, e.g. ${name}<number>()`,
            call.node,
          );
          continue;
        }

        // Type parameters around the call are checked where they are given.
        const made =
          value.kind === 'make' ? input.make(given, () => ({ code: '0' })) : { code: '' };
        const reason =
          'error' in made
            ? made.error
            : value.kind === 'decode'
              ? input.notDecoded(withoutParams(given, input.owners))
              : null;

        if (reason !== null) {
          input.error(
            `cannot ${value.kind} ${typeToString(given)} for ${param} of ${name}: ${reason}`,
            call.node,
          );
        }
      }
    }
  }

  /**
   * The different types each function is called with, or 'open' when they are not all known: an
   * exported function is called by other modules.
   */
  private instances(): Map<ast.FuncDeclaration, Map<string, Map<TypeParam, Type>> | 'open'> {
    const instances = new Map<ast.FuncDeclaration, Map<string, Map<TypeParam, Type>> | 'open'>();

    for (const fn of this.needs.keys()) instances.set(fn, fn.exported ? 'open' : new Map());

    for (let changed = true; changed;) {
      changed = false;
      for (const call of this.input.calls) {
        const fn = this.declarationOf(call.signature);
        const found = fn && instances.get(fn);

        if (!fn || !found || found === 'open') continue;

        const added = this.instancesOf(call, instances);

        if (added === 'open') {
          instances.set(fn, 'open');
          changed = true;
          continue;
        }

        for (const bindings of added) {
          const key = this.needs
            .get(fn)!
            .map((value) => `${value.kind}:${typeToString(bindings.get(value.param) ?? ANY)}`)
            .join(',');

          if (found.has(key)) continue;

          found.set(key, bindings);
          changed = true;
          if (found.size > MAX_INSTANCES) instances.set(fn, 'open');
        }
      }
    }

    return instances;
  }

  /** The type arguments that a call gives in each instance of the functions around it. */
  private instancesOf(
    call: GenericCall,
    instances: Map<ast.FuncDeclaration, Map<string, Map<TypeParam, Type>> | 'open'>,
  ): Map<TypeParam, Type>[] | 'open' {
    let combos = [new Map<TypeParam, Type>()];

    for (const outer of this.around.get(call.node) ?? []) {
      const found = instances.get(outer);

      // A function that needs nothing has no instances to tell apart.
      if (found === undefined) continue;
      if (found === 'open') {
        const uses = outer.typeParams.length > 0 && this.usesParamsOf(call, outer);

        if (uses) return 'open';
        continue;
      }

      // The call is in a function that is never called: it gives nothing yet.
      if (found.size === 0) return [];
      if (!this.usesParamsOf(call, outer)) continue;
      combos = combos.flatMap((combo) =>
        [...found.values()].map((bindings) => new Map([...combo, ...bindings])),
      );
    }

    return combos.map((combo) => {
      const bindings = new Map<TypeParam, Type>();

      for (const [param, type] of call.bindings) bindings.set(param, substitute(type, combo));

      return bindings;
    });
  }

  private usesParamsOf(call: GenericCall, fn: ast.FuncDeclaration): boolean {
    const params = new Set(
      [...this.input.owners].flatMap(([param, owner]) => (owner === fn ? [param] : [])),
    );

    return [...call.bindings.values()].some((type) => containsTypeParam(type, params));
  }
}

/** The type with the type parameters of functions as any, which decode takes. */
function withoutParams(type: Type, owners: ReadonlyMap<TypeParam, unknown>): Type {
  return substitute(type, new Map([...owners.keys()].map((param) => [param, ANY])));
}

function calleeName(node: ast.CallExpression): string {
  const { callee } = node;

  if (callee.kind === 'Identifier') return callee.name;
  if (callee.kind === 'MemberExpression') return callee.property.name;

  return 'the function';
}
