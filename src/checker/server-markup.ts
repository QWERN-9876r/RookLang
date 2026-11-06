import type * as ast from '../ast.ts';
import { CONTENT } from './dom.ts';
import { MarkupChecker } from './markup.ts';
import type { CheckOptions } from './context.ts';
import { contentResult, HTML } from './server.ts';
import { isAssignable, typeToString, widenLiterals, type Type } from './types.ts';

// Markup on the server ("rook": { "markup": "html" }, docs/server.md): it gives Html, a string of
// HTML, its attributes are checked by the DOM as in the browser, and what only the browser has
// (handlers, bind:, ref) is an error. Markup that has components in it waits for them, so it is
// allowed only where code may wait.

export abstract class ServerMarkupChecker extends MarkupChecker {
  /** Markup of the server, `"markup": "html"`. */
  protected readonly server: boolean;

  /** How deep in markup the check is: the markup at 0 is the one that waits for what is inside. */
  protected markupDepth = 0;

  /** What makes the current markup wait: the first component in it, or `{children}`. */
  protected waitsFor: string | null = null;

  /**
   * The one component among the children of a use whose children are `Content<T>`: what it gives
   * goes to the component, not into markup.
   */
  protected contentChild: ast.ElementExpression | null = null;

  /** What the uses of components gave, for the type of the children of a use around them. */
  protected readonly tagTypes = new WeakMap<ast.ElementExpression, Type>();

  constructor(program: ast.Program, options: CheckOptions) {
    super(program, options);
    this.server = options.server === true;
    // What markup gives is a type of its own there.
    if (this.server) this.globals.types.set('Html', HTML);
  }

  protected override checkElement(node: ast.ElementExpression): Type {
    if (!this.server) return super.checkElement(node);

    const top = this.markupDepth === 0;
    const saved = this.waitsFor;

    if (top) this.waitsFor = null;
    this.markupDepth++;

    let type: Type;

    try {
      type = isComponentTag(node) ? this.checkServerComponentTag(node, top) : this.checkTag(node);
    } finally {
      this.markupDepth--;
    }

    if (top) {
      if (this.waitsFor !== null && !this.canWait()) {
        this.error(
          `${this.waitsFor} waits for the component: use it in a component, an async function or at the top level of a module`,
          node,
        );
      }

      this.waitsFor = saved;
    }

    return type;
  }

  protected override checkChildren(children: readonly ast.JsxChild[]): void {
    if (!this.server) {
      super.checkChildren(children);

      return;
    }

    for (const child of children) {
      if (child.kind !== 'JsxExpressionContainer') {
        super.checkChildren([child]);
        continue;
      }

      const content = this.checkValue(child.expression);

      // `{children}` renders the children there, and waits for them.
      if (content === CONTENT || contentResult(content) !== null) this.waitsFor ??= '{children}';
      if (this.isServerContent(content)) continue;
      this.error(
        content.kind === 'bool'
          ? 'cannot use bool as element content: use a condition, e.g. {ok ? <b>yes</b> : null}'
          : `cannot use ${typeToString(content)} as element content: on the server it is Html, a string, a number, an array of them or null`,
        child.expression,
      );
    }
  }

  /** What markup can show on the server; a Response among the children is the answer instead. */
  protected isServerContent(given: Type): boolean {
    if (given === CONTENT) return true;

    const children = contentResult(given);

    if (children !== null) return this.isServerContent(children);

    const type = widenLiterals(given);

    switch (type.kind) {
      case 'string':
      case 'number':
      case 'bigint':
      case 'any':
      case 'unknown':
      case 'never':
      case 'null':
        return true;

      case 'nullable':
        return this.isServerContent(type.type);

      case 'array':
        return this.isServerContent(type.element);

      case 'union':
        return type.types.every((each) => this.isServerContent(each));

      case 'class':
      case 'object':
        return isAssignable(type, HTML) || this.isResponse(type);

      default:
        return false;
    }
  }

  /** Whether code here may wait: in an async function, a component or at the top level. */
  protected canWait(): boolean {
    return this.fn === null || this.fn.isAsync === true;
  }

  /** A use of a component inside markup gives its result, which markup must be able to show. */
  private checkServerComponentTag(node: ast.ElementExpression, top: boolean): Type {
    const type = super.checkElement(node);

    this.tagTypes.set(node, type);
    this.waitsFor ??= `<${node.tag!.name} />`;
    if (!top && node !== this.contentChild && !this.isServerContent(type)) {
      this.error(
        `a component of type ${typeToString(type)} cannot be in markup; return it, or show its fields, e.g. {user.name}`,
        node,
      );
    }

    return type;
  }

  /** An element: what only the browser has is reported, the rest is checked as in the browser. */
  private checkTag(node: ast.ElementExpression): Type {
    const attributes = node.attributes.filter((attribute) => {
      if (attribute.kind !== 'JsxAttribute') return true;

      const problem = browserOnly(attribute.name.name);

      if (problem) this.error(problem, attribute.name);

      return problem === null;
    });

    super.checkElement({ ...node, attributes });

    return HTML;
  }

  private isResponse(type: Type): boolean {
    const response = this.lookupType('Response');

    return response !== undefined && response.kind !== 'alias' && isAssignable(type, response);
  }
}

/** `<Card />`, `<section.content />`: a use of a component, which gives what the component does. */
export function isComponentTag(node: ast.ElementExpression): boolean {
  return node.tag !== null && (node.value !== null || /^[A-Z]/.test(node.tag.name));
}

/** Why an attribute of an element has no meaning on the server, or null if it has one. */
function browserOnly(name: string): string | null {
  if (/^on[A-Z]/.test(name)) {
    return `"${name}" has no meaning on the server: markup there is a string; make a client component with @html-tag for code that runs in the browser`;
  }

  if (name.startsWith('bind:')) {
    return `"${name}" has no meaning on the server: markup there is a string, and nothing changes it`;
  }

  if (name === 'ref') {
    return '"ref" has no meaning on the server: there are no elements, only a string of HTML';
  }

  return null;
}
