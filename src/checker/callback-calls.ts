import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';
import { callSignature, givenToCallback } from './helpers.ts';
import { MemberChecker } from './members.ts';
import {
  containsTypeParam,
  inferTypeParams,
  nonNull,
  substitute,
  union,
  VOID,
  widenLiterals,
  type FunctionType,
  type Type,
  type TypeParam,
} from './types.ts';

/** A stand-in for a type parameter while its callback is checked, and what the calls gave it. */
interface Collector {
  readonly types: Type[];
  /** The type it stands for once the callback is checked. */
  done: Type | null;
}

/**
 * Type parameters that only the functions a callback gets have, T of `resolve` in
 * `new Promise(resolve => ...)`, are inferred from the calls of those functions in its body:
 * `resolve(1)` makes the promise a `Promise<number>`. While the callback is checked, T stands for a
 * parameter of its own that collects the arguments of those calls. A function that is passed on,
 * `setTimeout(resolve, 5)`, gets arguments that the body does not show: then nothing says what T
 * is, and it is its default, or void.
 */
export abstract class CallbackCallChecker extends MemberChecker {
  private readonly collectors = new Map<TypeParam, Collector>();

  /**
   * Gives the type parameters that the arrow function `arg` alone can tell their stand-ins, or
   * their defaults when it does not only call the functions that get them. The result goes to
   * closeCallback() after the arrow function is checked.
   */
  protected openCallback(
    arg: ast.ArrowFunction,
    param: Type,
    signature: FunctionType,
    inferred: Map<TypeParam, Type>,
  ): Map<TypeParam, TypeParam> {
    const open = givenToCallback(param, signature, inferred);
    const stands = new Map<TypeParam, TypeParam>();
    const callback = callSignature(nonNull(param));

    if (open.length === 0 || !callback) return stands;

    // The parameters of the arrow function that get functions with these type parameters.
    const names = new Set<string>();

    arg.params.forEach((each, i) => {
      const type = callback.params[i];

      if (!each.rest && type && containsTypeParam(type, new Set(open))) names.add(each.name.name);
    });

    const called = onlyCalled(arg.body, names);

    for (const each of open) {
      if (!called) {
        inferred.set(each, each.default ?? VOID);
        continue;
      }

      const stand: TypeParam = { ...each };

      this.collectors.set(stand, { types: [], done: null });
      stands.set(each, stand);
      inferred.set(each, stand);
    }

    return stands;
  }

  /** The type parameters get what the calls gave them; the type of the arrow function too. */
  protected closeCallback(
    arg: ast.ArrowFunction,
    type: Type,
    stands: ReadonlyMap<TypeParam, TypeParam>,
    inferred: Map<TypeParam, Type>,
  ): Type {
    if (stands.size === 0) return type;

    const bindings = new Map<TypeParam, Type>();

    for (const [param, stand] of stands) {
      const collector = this.collectors.get(stand)!;
      const result = collector.types.length > 0 ? union(collector.types) : (param.default ?? VOID);

      collector.done = result;
      bindings.set(stand, result);
      inferred.set(param, result);
    }

    const closed = substitute(type, bindings);

    this.checkedTypes.set(arg, closed);

    return closed;
  }

  /**
   * An argument of a call of such a function, `resolve(1)`: what it gives T is collected, and the
   * argument is checked against the parameter with it. Gives false for other arguments.
   */
  protected collectArgument(arg: ast.Expression, param: Type, index: number): boolean {
    if (this.collectors.size === 0) return false;

    const stands = [...this.collectors.keys()].filter((stand) =>
      containsTypeParam(param, new Set([stand])),
    );

    if (stands.length === 0) return false;

    const type = this.checkValue(arg, arg.kind === 'ArrowFunction' ? param : null);
    const found = new Map<TypeParam, Type>();

    inferTypeParams(param, type, found);

    const bindings = new Map<TypeParam, Type>();

    for (const stand of stands) {
      const collector = this.collectors.get(stand)!;
      const given = found.get(stand);

      // A body that is checked later, after the callback, is checked against what T became.
      if (collector.done) bindings.set(stand, collector.done);
      else if (given) {
        collector.types.push(widenLiterals(given));
        bindings.set(stand, given);
      }
    }

    this.expectAssignable(type, substitute(param, bindings), arg, ` in argument ${index + 1}`);

    return true;
  }
}

/**
 * Whether each use of `names` in `node` is a call, `resolve(1)`, and not a value passed on,
 * `setTimeout(resolve, 5)`. A property of the same name, `promise.resolve`, is not a use.
 */
function onlyCalled(node: ast.Node, names: ReadonlySet<string>): boolean {
  let only = true;
  const visit = (child: ast.Node): void => {
    if (!only) return;
    if (child.kind === 'Identifier') {
      if (names.has(child.name)) only = false;

      return;
    }

    if (child.kind === 'CallExpression' && child.callee.kind === 'Identifier') {
      child.arguments.forEach(visit);

      return;
    }

    if (child.kind === 'MemberExpression') {
      visit(child.object);

      return;
    }

    forEachChild(child, visit);
  };

  visit(node);

  return only;
}
