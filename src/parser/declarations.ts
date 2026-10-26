import type * as ast from '../ast.ts';
import { JumpParser } from './jumps.ts';
import { describe, FUNCTION_BODY, VISIBILITIES } from './syntax.ts';

// Imports and exports, functions and components with their parameters and results.

export abstract class DeclarationParser extends JumpParser {
  protected override parseImport(): ast.ImportDeclaration {
    const start = this.next().start;

    if (!this.context.topLevel) {
      this.error(
        'imports are only allowed at the top level of a module',
        start,
        this.span(start).end,
      );
    }

    let defaultImport: ast.Identifier | null = null;
    let namespaceImport: ast.Identifier | null = null;
    let namedImports: ast.ImportSpecifier[] = [];

    if (!this.check('String')) {
      const hasDefault = this.check('Identifier');

      if (hasDefault) defaultImport = this.parseIdentifier('import name');
      if (!hasDefault || this.accept(',')) {
        if (this.accept('*')) {
          this.expectWord('as');
          namespaceImport = this.parseIdentifier('namespace name');
        } else {
          this.expect('{', '"{", "*" or a name');
          namedImports = this.parseList('}', () => this.parseImportSpecifier());
        }
      }

      this.expectWord('from');
    }

    const source = this.parseStringLiteral('module path');
    const declaration: ast.ImportDeclaration = {
      kind: 'ImportDeclaration',
      defaultImport,
      namespaceImport,
      namedImports,
      source,
      ...this.span(start),
    };

    this.endStatement();

    return declaration;
  }

  protected parseImportSpecifier(): ast.ImportSpecifier {
    const token = this.peek();
    const imported = this.parsePropertyName('import name');
    let local = imported;

    if (this.acceptWord('as')) {
      local = this.parseIdentifier('import name');
    } else if (token.kind !== 'Identifier') {
      this.error(`"${token.text}" is a keyword: rename it with "as"`, token.start, token.end);
    }

    return { kind: 'ImportSpecifier', imported, local, ...this.span(token.start) };
  }

  protected override parseExport(): ast.Statement {
    const start = this.next().start;

    if (!this.context.topLevel) {
      this.error(
        '"export" is only allowed at the top level of a module',
        start,
        this.span(start).end,
      );
    }

    return (
      this.parseDeclaration(start, true) ??
      this.fail(`expected a declaration after "export", found ${describe(this.peek())}`)
    );
  }

  protected override parseFuncDeclaration(start: number, exported: boolean): ast.FuncDeclaration {
    const async = this.accept('async');

    this.expect('func');

    const name = this.parseIdentifier('function name');
    const typeParams = this.parseTypeParams();
    const params = this.parseParams(false);
    const results = this.parseResults();
    const body = this.parseFunctionBody(async);

    return {
      kind: 'FuncDeclaration',
      exported,
      isPublic: false,
      ...(async ? { async } : {}),
      name,
      typeParams,
      params,
      results,
      body,
      ...this.span(start),
    };
  }

  /**
   * `<T any, U Shape>` after a name; `<K, V any>` gives both the constraint, as in Go.
   */
  protected parseTypeParams(): ast.TypeParameter[] {
    if (!this.check('<') || this.peek(1).kind !== 'Identifier') return [];
    this.next();

    const params: ast.TypeParameter[] = [];
    let pending: ast.Identifier[] = [];
    const finish = (constraint: ast.TypeNode | null) => {
      for (const name of pending) {
        params.push({
          kind: 'TypeParameter',
          name,
          constraint,
          start: name.start,
          end: constraint?.end ?? name.end,
        });
      }

      pending = [];
    };

    do {
      pending.push(this.parseIdentifier('type parameter name'));
      if (!this.check(',') && !this.peek().kind.startsWith('>')) finish(this.parseType());
    } while (this.accept(','));

    finish(null);
    this.expectTypeClose('">" after the type parameters');

    return params;
  }

  /**
   * `(a, b number, c string)`. Names without a type take the type of the next typed name, as in
   * Go; only arrow functions may leave types out entirely. The parameters of a constructor can be
   * properties: `(private name string)`.
   */
  protected parseParams(
    typesOptional: boolean,
    allowDefaults = false,
    allowRest = false,
    allowProperties = false,
  ): ast.Parameter[] {
    this.expect('(');

    const params: ast.Parameter[] = [];
    let untyped = 0;

    while (!this.check(')')) {
      if (this.check('...')) {
        params.push(this.parseRestParam(allowRest));
        break;
      }

      const paramStart = this.peek().start;
      const property = this.parsePropertyModifiers(allowProperties);
      const name = this.parseIdentifier('parameter name');
      const type = this.canStartType() ? this.parseType() : null;
      const defaultValue = allowDefaults && this.accept('=') ? this.parseExpression() : null;

      params.push({
        kind: 'Parameter',
        name,
        type,
        defaultValue,
        ...(property ? { property } : {}),
        ...this.span(paramStart),
      });
      if (type === null) {
        untyped++;
      } else {
        for (const param of params.slice(params.length - 1 - untyped)) param.type = type;
        untyped = 0;
      }

      if (!this.accept(',')) break;
    }

    this.expect(')');
    if (untyped > 0 && !typesOptional) {
      const param = params[params.length - untyped]!;

      this.error(`missing type for parameter "${param.name.name}"`, param.start, param.end);
    }

    return params;
  }

  /** `private`, `readonly` or both before a parameter that is a property of its class. */
  private parsePropertyModifiers(allowed: boolean): ast.Parameter['property'] | null {
    let visibility: ast.Visibility | null = null;
    let readonly = false;
    const start = this.peek().start;

    // Elsewhere `readonly number` is a parameter named readonly, and `private x number` an error.
    while (
      this.check('Identifier') &&
      (VISIBILITIES.has(this.peek().text) || this.peek().text === 'readonly') &&
      this.peek(1).kind === 'Identifier' &&
      (allowed || this.peek(2).kind === 'Identifier')
    ) {
      const modifier = this.next();

      if (modifier.text === 'readonly') {
        if (readonly) this.error('duplicate "readonly" modifier', modifier.start, modifier.end);
        readonly = true;
      } else {
        if (visibility) this.error('duplicate visibility modifier', modifier.start, modifier.end);
        visibility = modifier.text as ast.Visibility;
      }
    }

    if (visibility === null && !readonly) return null;
    if (!allowed) {
      this.error(
        'only the parameters of a constructor can be properties, e.g. constructor(private name string)',
        start,
        this.span(start).end,
      );
    }

    return { visibility: visibility ?? 'public', ...(readonly ? { readonly: true } : {}) };
  }

  /** `...attrs`: the attributes that a component passes on to one of its elements. */
  private parseRestParam(allowed: boolean): ast.Parameter {
    const start = this.next().start;
    const name = this.parseIdentifier('parameter name');

    if (!allowed) {
      this.error(
        `...${name.name} is only for components: it takes the attributes of an element`,
        start,
        name.end,
      );
    }

    if (this.canStartType() || this.check('=')) {
      const at = this.peek().start;

      // After the error, the type and the default are read, so they are not reported again.
      if (this.canStartType()) this.parseType();
      if (this.accept('=')) this.parseExpression();
      this.error(
        `...${name.name} has no type and no default: it gets the type of the element it is spread on`,
        at,
        this.span(at).end,
      );
    }

    // After the error, the rest of the list is skipped up to the `)`.
    if (this.check(',')) {
      this.error(`...${name.name} is the last property of a component`, start, name.end);
      while (!this.check(')') && !this.check('EOF')) this.next();
    }

    return {
      kind: 'Parameter',
      name,
      type: null,
      defaultValue: null,
      rest: true,
      ...this.span(start),
    };
  }

  /** Result types after a parameter list: nothing, `T`, or `(T1, T2)`. */
  protected parseResults(): ast.TypeNode[] {
    if (this.accept('(')) return this.parseList(')', () => this.parseType());
    // `{` after the parameters starts the body, so an object result type needs parentheses.
    if (this.canStartType() && !this.check('{')) return [this.parseType()];

    return [];
  }

  /** `comp Name(properties) { ...; return <markup> }`, maybe after decorators. */
  protected override parseComponent(
    start: number,
    exported: boolean,
    htmlTag: ast.HtmlTag | null = null,
    decorators: ast.DecoratorUse[] = [],
  ): ast.ComponentDeclaration {
    this.requireMarkup('components are');

    const keyword = this.expect('comp');

    if (!this.context.topLevel) {
      this.error(
        'components can only be declared at the top level of a module',
        keyword.start,
        keyword.end,
      );
    }

    const name = this.parseIdentifier('component name');

    // A web component is used by its tag, so its name may start with a lowercase letter.
    if (!htmlTag && !/^[A-Z]/.test(name.name)) {
      this.error(
        `component names start with a capital letter, as in <${name.name.charAt(0).toUpperCase()}${name.name.slice(1)} />`,
        name.start,
        name.end,
      );
    }

    const params = this.parseParams(false, true, true);
    const body = this.withContext({ ...FUNCTION_BODY, inComponent: true }, () =>
      this.parseComponentBody(),
    );

    return {
      kind: 'ComponentDeclaration',
      exported,
      name,
      params,
      body,
      htmlTag,
      decorators,
      ...this.span(start),
    };
  }

  /** Like a function body, but its own statements may also declare `state`, `ref` and `mount()`. */
  protected parseComponentBody(): ast.BlockStatement {
    const start = this.expect('{').start;
    const body: ast.Statement[] = [];

    this.parseSeparated(
      () => this.check('}'),
      () => body.push(this.parseComponentStatement()),
    );
    this.expect('}');

    return { kind: 'BlockStatement', body, ...this.span(start) };
  }

  /** A statement at the top level of a component or a decorator. */
  protected parseComponentStatement(): ast.Statement {
    if (this.isStyleBlock()) {
      const style = this.parseStyle();

      this.endStatement();

      return style;
    }

    if (this.isMountDeclaration() || this.isEffectDeclaration()) {
      const statement = this.isMountDeclaration() ? this.parseMount() : this.parseEffect();

      this.endStatement();

      return statement;
    }

    if (!this.isStateDeclaration() && !this.isRefDeclaration()) return this.parseStatement();

    const declaration = this.parseVariableDeclaration(this.peek().start, false);

    this.endStatement();

    return declaration;
  }
}
