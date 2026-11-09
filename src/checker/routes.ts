import type * as ast from '../ast.ts';
import { CallChecker } from './calls.ts';
import { isUntyped } from './helpers.ts';
import { HTML, ROUTE_FUNCTION, routeOf } from './server.ts';
import {
  isAssignable,
  STRING,
  typeToString,
  type FunctionType,
  type Type,
  type TypeParam,
} from './types.ts';

// `route("/users/:id", UserPage)` of "rooklang/server" (docs/server.md, "Routes"): the parameters
// of the path are the properties of the page. The path is a literal, so the checker reads them:
// each one is a property of the page that takes a string, and each property the page needs is
// one of them, so a typo in either is a compile error.

const EXAMPLE = 'route("/users/:id", UserPage)';

export abstract class RouteChecker extends CallChecker {
  protected override checkArguments(
    signature: FunctionType,
    args: readonly (ast.Expression | ast.SpreadElement)[],
    node: ast.NodeBase,
    inferred = new Map<TypeParam, Type>(),
    expected: Type | null = null,
  ): Type[] {
    if (signature !== ROUTE_FUNCTION) {
      return super.checkArguments(signature, args, node, inferred, expected);
    }

    const [path, page, ...extra] = args;

    if (!path || !page || path.kind === 'SpreadElement' || page.kind === 'SpreadElement') {
      this.error(`route() takes a path and a page, e.g. ${EXAMPLE}`, node);
      this.checkArgumentsLoosely(args);

      return [routeOf(HTML)];
    }

    this.checkArgumentsLoosely(extra);
    if (extra[0]) this.error('too many arguments: expected 2, got ' + args.length, extra[0]);

    this.expectAssignable(this.checkValue(path, STRING), STRING, path);

    const type = this.checkValue(page);

    if (isUntyped(type)) return [routeOf(HTML)];
    if (type.kind !== 'component') {
      this.error(
        `the page of a route is a component, not ${typeToString(type)}: e.g. ${EXAMPLE}`,
        page,
      );

      return [routeOf(HTML)];
    }

    const text = literalText(path);

    if (text === null) {
      this.error(
        `the path of a route is a string literal, so that its parameters are checked: e.g. ${EXAMPLE}`,
        path,
      );
    } else {
      this.checkPath(text, path, type.params, pageName(page));
    }

    return [routeOf(type.result ?? HTML)];
  }

  private checkPath(
    text: string,
    path: ast.Expression,
    props: readonly { name: string; type: Type; optional: boolean }[],
    page: string,
  ): void {
    const params = new Set<string>();

    for (const segment of text.split('/')) {
      if (!segment.startsWith(':')) continue;

      const name = segment.slice(1);

      if (!/^[A-Za-z_][\w]*$/.test(name)) {
        this.error(
          `"${segment}" is not a parameter: a parameter is ":" and a name, e.g. /users/:id`,
          path,
        );
      } else if (params.has(name)) {
        this.error(`the path has ":${name}" twice: give each parameter its own name`, path);
      }

      params.add(name);
    }

    // A typo: one parameter that is not a property and one property that is not a parameter.
    const missing = props.filter((prop) => !prop.optional && !params.has(prop.name));
    const rename = missing.length === 1 ? `rename it to ":${missing[0]!.name}"` : 'rename it';

    for (const name of params) {
      const prop = props.find((each) => each.name === name);

      if (!prop) {
        this.error(
          `${page} has no property "${name}" for ":${name}" of "${text}": ${rename}, or add the property`,
          path,
        );
      } else if (!isUntyped(prop.type) && !isAssignable(STRING, prop.type)) {
        this.error(
          `":${name}" of "${text}" is a string, but "${name}" of ${page} is ${typeToString(prop.type)}`,
          path,
        );
      }
    }

    for (const prop of missing) {
      this.error(
        `${page} needs the property "${prop.name}", which "${text}" does not give: add ":${prop.name}" to the path, or give the property a default value`,
        path,
      );
    }
  }
}

/** The text of `"/users/:id"`, or of a template without values. */
function literalText(node: ast.Expression): string | null {
  if (node.kind === 'StringLiteral') return node.value;
  if (node.kind === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value ?? '';
  }

  return null;
}

/** `UserPage`, or `the page` for one that is not a name. */
function pageName(node: ast.Expression): string {
  return node.kind === 'Identifier' ? node.name : 'the page';
}
