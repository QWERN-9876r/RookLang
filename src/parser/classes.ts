import type * as ast from '../ast.ts';
import { isKeyword, type Token } from '../lexer/token.ts';
import { DecoratorParser } from './decorators.ts';
import { MODIFIERS, VISIBILITIES } from './syntax.ts';

// Classes and their members, interfaces and `type` aliases.

export abstract class ClassParser extends DecoratorParser {
  protected override parseClass(start: number, exported: boolean): ast.ClassDeclaration {
    const abstract = this.acceptWord('abstract');
    const data = this.acceptWord('data');

    this.expect('class');

    const name = this.parseIdentifier('class name');
    const typeParams = this.parseTypeParams();

    let superClass: ast.Expression | null = null;

    if (this.accept('extends')) {
      superClass = this.withContext({ noObjectLiteral: true }, () =>
        this.parsePostfix(this.parsePrimary()),
      );
    }

    const interfaces: ast.TypeReference[] = [];

    if (this.acceptWord('implements')) {
      do {
        const interfaceName = this.parseIdentifier('interface name');

        interfaces.push({
          kind: 'TypeReference',
          name: interfaceName,
          typeArgs: this.parseTypeArgs(),
          ...this.span(interfaceName.start),
        });
      } while (this.accept(','));
    }

    this.expect('{');

    const members: ast.ClassMember[] = [];

    this.withContext({ topLevel: false, inAsync: false }, () => {
      this.parseSeparated(
        () => this.check('}'),
        () => {
          members.push(...this.parseClassMember());
        },
      );
    });
    this.expect('}');

    return {
      kind: 'ClassDeclaration',
      exported,
      data,
      ...(abstract ? { abstract } : {}),
      name,
      typeParams,
      superClass,
      implements: interfaces,
      members,
      ...this.span(start),
    };
  }

  protected parseClassMember(): ast.ClassMember[] {
    const start = this.peek().start;
    let visibility: ast.Visibility | null = null;
    const modifiers = new Map<string, Token>();

    // Modifiers are contextual: `static` is a modifier only when a member name follows it.
    while (this.peek().kind === 'Identifier' && MODIFIERS.has(this.peek().text)) {
      const following = this.peek(1);

      if (following.kind !== 'Identifier' && !isKeyword(following.kind)) break;

      const modifier = this.next();

      if (VISIBILITIES.has(modifier.text)) {
        if (visibility) this.error('duplicate visibility modifier', modifier.start, modifier.end);
        visibility = modifier.text as ast.Visibility;
      } else {
        if (modifiers.has(modifier.text)) {
          this.error(`duplicate "${modifier.text}" modifier`, modifier.start, modifier.end);
        }

        modifiers.set(modifier.text, modifier);
      }
    }

    const isStatic = modifiers.has('static');
    // `async load()`; a method named `async` is `async()`.
    const asyncToken = this.check('async') && this.peek(1).kind !== '(' ? this.next() : null;
    const async = asyncToken !== null;

    if (this.checkWord('constructor') && this.peek(1).kind === '(') {
      this.next();
      if (isStatic) this.error('constructors cannot be static', start, this.span(start).end);
      if (async) this.error('a constructor cannot be async', start, this.span(start).end);
      for (const word of ['readonly', 'abstract']) {
        const modifier = modifiers.get(word);

        if (modifier) this.error(`a constructor cannot be ${word}`, modifier.start, modifier.end);
      }

      const params = this.parseParams(false, false, false, true);
      const resultsStart = this.peek().start;

      if (this.parseResults().length > 0) {
        this.error('constructors cannot have result types', resultsStart, this.span(start).end);
      }

      const body = this.parseFunctionBody();

      return [
        {
          kind: 'ConstructorDeclaration',
          visibility: visibility ?? 'public',
          params,
          body,
          ...this.span(start),
        },
      ];
    }

    // `get area()`; a method named `get` is `get()`, a field `get string`.
    const accessorToken =
      (this.checkWord('get') || this.checkWord('set')) &&
      isName(this.peek(1)) &&
      this.peek(2).kind === '('
        ? this.next()
        : null;
    const name = this.parsePropertyName('member name');

    if (this.check('(')) {
      return [
        this.parseMethod(start, name, visibility ?? 'public', modifiers, asyncToken, accessorToken),
      ];
    }

    if (asyncToken) this.error('only methods can be async', asyncToken.start, asyncToken.end);

    const abstract = modifiers.get('abstract');

    if (abstract) {
      this.error(
        'only methods can be abstract: for a field, declare an abstract getter, e.g. abstract get name() string',
        abstract.start,
        abstract.end,
      );
    }

    // Fields: `name string`, `count = 0`, `x, y number`.
    const names = [name];

    while (this.accept(',')) names.push(this.parsePropertyName('field name'));

    const type = this.canStartType() ? this.parseType() : null;
    const value = this.accept('=') ? this.parseExpression() : null;
    const span = this.span(start);

    if (type === null && value === null) {
      this.error(`field "${name.name}" needs a type or a value`, span.start, span.end);
    } else if (names.length > 1 && value !== null) {
      this.error('a value can only be given to a single field', span.start, span.end);
    }

    this.endStatement();

    return names.map((fieldName): ast.FieldDeclaration => ({
      kind: 'FieldDeclaration',
      visibility: visibility ?? 'public',
      isStatic,
      ...(modifiers.has('readonly') ? { readonly: true } : {}),
      name: fieldName,
      type,
      value,
      ...span,
    }));
  }

  /** A method, a getter or a setter, after its name; an abstract one has no body. */
  private parseMethod(
    start: number,
    name: ast.Identifier,
    visibility: ast.Visibility,
    modifiers: ReadonlyMap<string, Token>,
    asyncToken: Token | null,
    accessorToken: Token | null,
  ): ast.MethodDeclaration {
    const isStatic = modifiers.has('static');
    const readonly = modifiers.get('readonly');
    const abstract = modifiers.get('abstract');
    const accessor = accessorToken?.text as 'get' | 'set' | undefined;
    const async = asyncToken !== null;

    if (readonly) {
      this.error(
        'only fields can be readonly: a method cannot be assigned anyway',
        readonly.start,
        readonly.end,
      );
    }

    if (abstract && isStatic) {
      this.error('a static method cannot be abstract', abstract.start, abstract.end);
    } else if (abstract && visibility === 'private') {
      this.error(
        'an abstract method cannot be private: the subclasses that implement it could not see it',
        abstract.start,
        abstract.end,
      );
    }

    if (accessor && asyncToken) {
      this.error(`a ${accessor}ter cannot be async`, asyncToken.start, asyncToken.end);
    }

    const params = this.parseParams(false);
    const results = this.parseResults();
    const header = this.span(start);

    if (accessor === 'get' && (params.length > 0 || results.length !== 1)) {
      this.error(
        'a getter takes nothing and returns one value, e.g. get area() number',
        header.start,
        header.end,
      );
    } else if (accessor === 'set' && (params.length !== 1 || results.length > 0)) {
      this.error(
        'a setter takes one value and returns nothing, e.g. set area(v number)',
        header.start,
        header.end,
      );
    }

    let body: ast.BlockStatement | null = null;

    if (!abstract) body = this.parseFunctionBody(async);
    else if (this.check('{')) {
      const block = this.parseFunctionBody(async);

      this.error(
        'an abstract method has no body: the subclasses implement it',
        block.start,
        block.end,
      );
    } else {
      this.endStatement();
    }

    return {
      kind: 'MethodDeclaration',
      visibility,
      isStatic,
      ...(async ? { async } : {}),
      ...(accessor ? { accessor } : {}),
      ...(abstract ? { abstract: true } : {}),
      name,
      params,
      results,
      body,
      ...this.span(start),
    };
  }

  protected override parseInterface(start: number, exported: boolean): ast.InterfaceDeclaration {
    this.expect('interface');

    const name = this.parseIdentifier('interface name');
    const typeParams = this.parseTypeParams();
    const members = this.parseTypeMembers();

    return {
      kind: 'InterfaceDeclaration',
      exported,
      name,
      typeParams,
      members,
      ...this.span(start),
    };
  }

  protected override parseTypeAlias(start: number, exported: boolean): ast.TypeAliasDeclaration {
    this.expect('type');

    const name = this.parseIdentifier('type name');
    const typeParams = this.parseTypeParams();
    const type = this.parseType();

    return {
      kind: 'TypeAliasDeclaration',
      exported,
      name,
      typeParams,
      type,
      ...this.span(start),
    };
  }
}

/** A member name: keywords can be names after `.` and in classes. */
function isName(token: Token): boolean {
  return token.kind === 'Identifier' || isKeyword(token.kind);
}
