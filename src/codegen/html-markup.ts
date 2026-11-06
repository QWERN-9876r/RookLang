import type * as ast from '../ast.ts';
import { forEachChild } from '../walk.ts';
import { FunctionEmitter } from './functions.ts';
import { POSTFIX } from './syntax.ts';

// Markup on the server ("rook": { "markup": "html" }, docs/server.md): a template of `$$html`,
// whose static parts are written here, escaped once, and whose values the runtime escapes
// (src/runtime/html.js). Uses of components are calls of their functions, which give Promises: the
// outermost markup waits for them, the markup inside gets them as values.

/** Elements that have no closing tag in HTML. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

export abstract class HtmlMarkupEmitter extends FunctionEmitter {
  /** A use of a component on the server: a call of its function; see ServerComponentEmitter. */
  protected abstract serverComponentUse(node: ast.ElementExpression): string;

  /** The names that `{children}` renders: the `children` of the component being written. */
  protected contentNames: ReadonlySet<string> = new Set();

  /** Inside the values of markup: the markup there is not waited for, the outer one waits. */
  private inMarkup = 0;

  /** The arrays that the blocks of `{if}` and `{for}` push their markup into, innermost last. */
  private readonly parts: string[] = [];

  private partsCount = 0;

  protected override element(node: ast.ElementExpression): string {
    if (!this.options.server) return super.element(node);

    const outer = this.inMarkup === 0;
    const text = this.htmlMarkup(node);

    return outer && this.waits(node) ? `await ${text}` : text;
  }

  protected override elementDeclaration(declaration: string, node: ast.ElementExpression): void {
    if (!this.options.server) {
      super.elementDeclaration(declaration, node);

      return;
    }

    this.line(`${declaration} = ${this.element(node)};`);
  }

  protected override elementStatement(node: ast.JsxElementStatement): void {
    const parts = this.parts.at(-1);

    if (!this.options.server || parts === undefined) {
      super.elementStatement(node);

      return;
    }

    this.line(`${parts}.push(${this.htmlMarkup(node.element)});`);
  }

  /** The JS of markup: a template, or the call of a component. */
  protected htmlMarkup(node: ast.ElementExpression): string {
    this.inMarkup++;
    try {
      if (this.isComponentUse(node)) return this.serverComponentUse(node);

      return `$$html\`${this.elementText(node)}\``;
    } finally {
      this.inMarkup--;
    }
  }

  /** `<Card />`, `<section.content />` or `<Page />` of a variable: a use of a component. */
  protected isComponentUse(node: ast.ElementExpression): boolean {
    return this.componentOf(node) !== undefined || this.tagValue(node) !== null;
  }

  /** The text of a template of `$$html` for the children of a component. */
  protected childrenText(children: readonly ast.JsxChild[]): string {
    this.inMarkup++;
    try {
      return children.map((child) => this.childText(child)).join('');
    } finally {
      this.inMarkup--;
    }
  }

  /**
   * Whether markup has components in it, or `{children}`: then it gives a Promise. The checker
   * allows it only where code may wait (server-markup.ts).
   */
  private waits(node: ast.Node): boolean {
    if (node.kind === 'ElementExpression' && this.isComponentUse(node)) return true;
    if (node.kind === 'JsxExpressionContainer' && this.isContent(node.expression)) return true;

    let found = false;

    forEachChild(node, (child) => {
      found ||= this.waits(child);
    });

    return found;
  }

  private elementText(node: ast.ElementExpression): string {
    const tag = node.tag?.name ?? null;
    const children = node.children.map((child) => this.childText(child)).join('');

    if (tag === null) return children;

    const doctype = tag === 'html' ? '<!doctype html>' : '';
    const attributes = node.attributes.map((attribute) => this.attributeText(attribute)).join('');

    if (VOID_ELEMENTS.has(tag) && node.children.length === 0) {
      return `${doctype}<${tag}${attributes}>`;
    }

    return `${doctype}<${tag}${attributes}>${children}</${tag}>`;
  }

  private childText(child: ast.JsxChild): string {
    switch (child.kind) {
      case 'JsxText':
        return templateText(escapeText(child.value));

      case 'ElementExpression':
        return this.isComponentUse(child)
          ? `\${${this.htmlMarkup(child)}}`
          : this.elementText(child);

      case 'JsxExpressionContainer':
        // `{children}` renders the children where it stands.
        return this.isContent(child.expression)
          ? `\${${this.expression(child.expression, POSTFIX)}?.()}`
          : `\${${this.expression(child.expression, 0)}}`;

      case 'JsxStatementContainer':
        return `\${${this.blockParts(child.statement)}}`;
    }
  }

  private attributeText(attribute: ast.JsxAttribute | ast.JsxSpreadAttribute): string {
    if (attribute.kind === 'JsxSpreadAttribute') {
      return `\${$$attrs(${this.expression(attribute.argument, 0)})}`;
    }

    const { name, value } = attribute;

    if (value === null) return ` ${name.name}`;
    if (value.kind === 'StringLiteral') {
      return templateText(` ${name.name}="${escapeAttribute(value.value)}"`);
    }

    // Handlers have no meaning here: the checker reports them.
    if (value.kind === 'EventHandler') return '';

    return `\${$$attr(${JSON.stringify(name.name)}, ${this.expression(value, 0)})}`;
  }

  /**
   * `{for item in items { <li>{item}</li> }}` runs once: its blocks push their markup into an
   * array, which the template gets as a value.
   */
  private blockParts(statement: ast.JsxStatementContainer['statement']): string {
    const parts = `$$parts${this.partsCount++}`;

    this.parts.push(parts);
    try {
      const body = this.block(() => {
        this.line(`const ${parts} = [];`);
        this.statement(statement);
        this.line(`return ${parts};`);
      });

      return `(() => ${body})()`;
    } finally {
      this.parts.pop();
    }
  }

  /** `children` of the component: `{children}` renders them. */
  private isContent(expression: ast.Expression): boolean {
    return expression.kind === 'Identifier' && this.contentNames.has(expression.name);
  }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Text of a JS template literal: what it would read itself is escaped. */
function templateText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
