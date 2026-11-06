import type * as ast from '../ast.ts';
import { ownBodyStart, publicMembers, type DecoratorSource } from '../decorators.ts';
import { decoratedName } from '../decorator-names.ts';
import { appliedDecorators, neededDecorators } from '../server-context.ts';
import { HtmlMarkupEmitter } from './html-markup.ts';
import { ARROW, POSTFIX } from './syntax.ts';

// Components on the server (docs/server.md): each one is an async function of an object of its
// properties and the context of the request, `async function $$Card({ title }, $$ctx)`. A use is
// a call, `$$Card({ title: "A" }, $$ctx)`, whose children are a function that renders them, so
// that the component decides whether they run.

export abstract class ServerComponentEmitter extends HtmlMarkupEmitter {
  /** The context of the request inside a component; outside of one, there is none yet. */
  private context = '{}';

  /** Lines that go before statements of the component being written: what it takes and gives. */
  private before = new Map<ast.Statement, string[]>();

  protected override statement(node: ast.Statement): void {
    const lines = this.before.get(node);

    if (lines) {
      this.before.delete(node);
      for (const line of lines) this.line(line);
    }

    super.statement(node);
  }

  protected override componentFunction(component: ast.ComponentDeclaration): void {
    if (!this.options.server) {
      super.componentFunction(component);

      return;
    }

    const props = component.params.filter((param) => !param.rest);
    const pattern = props.map((param) => {
      const local = this.name(param.name.name);
      const key = local === param.name.name ? local : `${param.name.name}: ${local}`;

      return param.defaultValue ? `${key} = ${this.expression(param.defaultValue, ARROW)}` : key;
    });
    const saved = { context: this.context, content: this.contentNames, before: this.before };

    const { needed, given } = this.contextLines(component);

    this.before = given;
    this.context = '$$ctx';
    this.contentNames = new Set(
      props.some((param) => param.name.name === 'children') ? ['children'] : [],
    );
    try {
      const [, body] = this.func(component.params, component.body);
      const exported = component.exported ? 'export ' : '';
      const params = pattern.length > 0 ? `{ ${pattern.join(', ')} }` : '$$props';
      // What it needs is taken first, before any defer of the body.
      const start = needed.map((line) => `\n${this.indent()}  ${line}`).join('');

      this.line(
        `${exported}async function $$${component.name.name}(${params}, $$ctx) {${start}${body.slice(1)}`,
      );
    } finally {
      this.context = saved.context;
      this.contentNames = saved.content;
      this.before = saved.before;
    }
  }

  /**
   * `needs session`: the members of @session from the context, under the names that `@session.user`
   * reads, before the body. The decorators the component applies go into the context after their
   * bodies, before the component's own, so that the components it uses see them.
   */
  private contextLines(component: ast.ComponentDeclaration): {
    needed: string[];
    given: Map<ast.Statement, string[]>;
  } {
    const needed: string[] = [];
    const given = new Map<ast.Statement, string[]>();
    const original =
      this.program.body.find(
        (statement): statement is ast.ComponentDeclaration =>
          statement.kind === 'ComponentDeclaration' && statement.name.name === component.name.name,
      ) ?? component;
    const sources = new Map<string, DecoratorSource>(this.options.decorators);

    for (const statement of this.program.body) {
      if (statement.kind === 'DecoratorDeclaration') {
        sources.set(statement.name.name, { node: statement, moduleNames: [] });
      }
    }

    const declarations = new Map([...sources].map(([name, source]) => [name, source.node]));
    const members = (decorator: ast.DecoratorDeclaration) => [
      ...publicMembers(decorator, sources).keys(),
    ];

    for (const name of neededDecorators(original, declarations)) {
      const decorator = declarations.get(name);
      const fields = decorator ? members(decorator) : [];
      const need = `$$need($$ctx, ${JSON.stringify(name)}, ${JSON.stringify(component.name.name)})`;
      const pattern = fields.map((field) => `${field}: ${decoratedName(name, field)}`);

      needed.push(pattern.length > 0 ? `const { ${pattern.join(', ')} } = ${need};` : `${need};`);
    }

    const provided = appliedDecorators(original, declarations).map((decorator) => {
      const name = decorator.name.name;
      const fields = members(decorator).map((field) => `${field}: ${decoratedName(name, field)}`);

      return fields.length > 0 ? `${name}: { ${fields.join(', ')} }` : `${name}: {}`;
    });

    // A defer is not written where it stands, so the line goes before the next statement.
    const own = component.body.body
      .slice(ownBodyStart(component))
      .find((statement) => statement.kind !== 'DeferStatement');

    if (provided.length > 0 && own) {
      given.set(own, [`$$ctx = $$provide($$ctx, { ${provided.join(', ')} });`]);
    }

    return { needed, given };
  }

  protected override serverComponentUse(node: ast.ElementExpression): string {
    const component = this.componentOf(node);
    const value = this.tagValue(node);
    const callee = component
      ? (this.functionNames.get(component) ?? `$$${component.name.name}`)
      : this.expression(value!, POSTFIX);
    const props = node.attributes.map((attribute) => this.serverProp(attribute));

    if (node.children.length > 0) {
      props.push(`children: ${this.serverChildren(node.children, takesMarkup(component))}`);
    } else if (component?.params.some((param) => param.name.name === 'children')) {
      // Without children, calling them gives nothing.
      props.push('children: () => null');
    }

    return `${callee}(${props.length > 0 ? `{ ${props.join(', ')} }` : '{}'}, ${this.context})`;
  }

  /** `title: "A"` of `title="A"`; `disabled` alone is true, `{...props}` spreads. */
  private serverProp(attribute: ast.JsxAttribute | ast.JsxSpreadAttribute): string {
    if (attribute.kind === 'JsxSpreadAttribute') {
      return `...${this.expression(attribute.argument, ARROW)}`;
    }

    const { name, value } = attribute;
    const key = /^[A-Za-z_$][\w$]*$/.test(name.name) ? name.name : JSON.stringify(name.name);

    if (value === null) return `${key}: true`;
    if (value.kind === 'EventHandler') {
      // Code for a function property runs when the component calls it, with `event`.
      const block: ast.BlockStatement = {
        kind: 'BlockStatement',
        body: value.body,
        start: value.start,
        end: value.end,
      };

      return `${key}: (event) => ${this.func([], block)[1]}`;
    }

    return `${key}: ${this.expression(value, ARROW)}`;
  }

  /**
   * The children: a function that renders them when the component asks. A single component is
   * its own result, any value, unless the component takes markup; other children are markup.
   */
  private serverChildren(children: readonly ast.JsxChild[], markup: boolean): string {
    const [only] = children;
    const component = only?.kind === 'ElementExpression' && this.isComponentUse(only) ? only : null;

    if (children.length === 1 && component && !markup) {
      return `() => ${this.htmlMarkup(component)}`;
    }

    return `() => $$html\`${this.childrenText(children)}\``;
  }
}

/**
 * Whether the children of a component are markup, `children Content` or `Content<Html>`: then a
 * Response among them goes up where they are called, as from any markup. Those of `Content<T>`
 * of another T, as of a wrapper, give what their one component gives.
 */
function takesMarkup(component: ast.ComponentDeclaration | undefined): boolean {
  const type = component?.params.find((param) => param.name.name === 'children')?.type;

  if (type?.kind !== 'TypeReference' || type.name.name !== 'Content') return false;

  const [result] = type.typeArgs;

  return (
    result === undefined ||
    (result.kind === 'TypeReference' && result.name.name === 'Html' && result.typeArgs.length === 0)
  );
}
