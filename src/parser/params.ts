import type * as ast from '../ast.ts';
import { JumpParser } from './jumps.ts';
import { VISIBILITIES } from './syntax.ts';

// The parameters of functions, constructors and components, with their modifiers, and the results
// of functions.

export abstract class ParamParser extends JumpParser {
  /**
   * `(a, b number, c string)`. Names without a type take the type of the next typed name, as in
   * Go; only arrow functions may leave types out entirely. The parameters of a constructor can be
   * properties: `(private name string)`. Functions take `...parts []any` last, and components
   * `...attrs`, the attributes of an element; both may have default values, `times = 1`.
   */
  protected parseParams(
    typesOptional: boolean,
    options: { defaults?: boolean; rest?: 'typed' | 'attrs'; properties?: boolean } = {},
  ): ast.Parameter[] {
    const { defaults: allowDefaults = false, properties: allowProperties = false } = options;
    const allowRest = options.rest === 'attrs';

    this.expect('(');

    const params: ast.Parameter[] = [];
    let untyped = 0;

    while (!this.check(')')) {
      if (this.check('...')) {
        params.push(
          options.rest === 'typed'
            ? this.parseTypedRest(typesOptional)
            : this.parseRestParam(allowRest),
        );
        break;
      }

      const paramStart = this.peek().start;
      const property = this.parsePropertyModifiers(allowProperties);
      const bind = this.parseBindModifier(allowRest);
      const name = this.parseIdentifier('parameter name');
      const type = this.canStartType() ? this.parseType() : null;
      const defaultValue = allowDefaults && this.accept('=') ? this.parseExpression() : null;

      if (bind && name.name === 'children') {
        this.error(
          'children cannot be bound: it is the content between the tags',
          paramStart,
          name.end,
        );
      }

      params.push({
        kind: 'Parameter',
        name,
        type,
        defaultValue,
        ...(property ? { property } : {}),
        ...(bind ? { bind: true as const } : {}),
        ...this.span(paramStart),
      });
      // `times = 1` has the type of its value.
      if (type === null && defaultValue !== null) {
        untyped = 0;
      } else if (type === null) {
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

  /**
   * `bind` before a property of a component, `bind active string`. Followed by a name and then
   * not by `,` or `)`, so a parameter named bind, `(bind Mode)`, stays one.
   */
  private parseBindModifier(allowed: boolean): boolean {
    const after = this.peek(2).kind;

    if (
      !this.checkWord('bind') ||
      this.peek(1).kind !== 'Identifier' ||
      after === ',' ||
      after === ')'
    ) {
      return false;
    }

    const modifier = this.next();

    if (!allowed) {
      this.error(
        'only the properties of components can be bound, e.g. comp Tabs(bind active string)',
        modifier.start,
        modifier.end,
      );
    }

    return true;
  }

  /** `...parts []any`: the arguments after the others, in an array, as in JS. */
  private parseTypedRest(typesOptional: boolean): ast.Parameter {
    const start = this.next().start;
    const name = this.parseIdentifier('parameter name');
    const type = this.canStartType() ? this.parseType() : null;

    if (type === null && !typesOptional) {
      this.error(
        `...${name.name} needs the type of its array, e.g. ...${name.name} []any`,
        start,
        name.end,
      );
    }

    // After the error, the rest of the list is skipped up to the `)`.
    if (this.check(',')) {
      this.error(`...${name.name} is the last parameter`, start, name.end);
      while (!this.check(')') && !this.check('EOF')) this.next();
    }

    if (this.check('='))
      this.error(
        `...${name.name} has no default value: it is [] without arguments`,
        start,
        name.end,
      );

    return { kind: 'Parameter', name, type, defaultValue: null, rest: true, ...this.span(start) };
  }

  /** `...attrs`: the attributes that a component passes on to one of its elements. */
  private parseRestParam(allowed: boolean): ast.Parameter {
    const start = this.next().start;
    const name = this.parseIdentifier('parameter name');

    if (!allowed) {
      this.error(
        `...${name.name} needs the type of its array, e.g. ...${name.name} []any`,
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

  /**
   * Result types after a parameter list: nothing, `T`, or `(T1, T2)`. A `{` may start the body
   * instead: it starts an object type when the body follows that type,
   * `func names() { [string]: string } { ... }`, or a value does, `f func() { [string]: T } = g`.
   * A method of an interface has no body, so there `{` is always a type.
   */
  protected parseResults(method = false): ast.TypeNode[] {
    if (this.accept('(')) return this.parseList(')', () => this.parseType());
    if (this.check('{') && !method && !this.objectTypeBeforeBody()) return [];
    if (this.canStartType()) return [this.parseType()];

    return [];
  }

  /** Whether the `{ ... }` here is followed by a body, `{`, or by a value, `=`. */
  private objectTypeBeforeBody(): boolean {
    let depth = 0;

    for (let offset = 0; ; offset++) {
      const { kind } = this.peek(offset);

      if (kind === 'EOF') return false;
      if (kind === '{') depth++;
      else if (kind === '}' && --depth === 0) {
        const next = this.peek(offset + 1).kind;

        return next === '{' || next === '=';
      }
    }
  }

  /**
   * The type of a parameter of a function type, after its name if it has one, kept in `names`;
   * `...` before the rest parameter is kept there too, `...parts`.
   */
  protected parseParamType(names: string[]): ast.TypeNode {
    const rest = this.accept('...') ? '...' : '';

    names.push(
      rest + (this.check('Identifier') && this.startsNamedParam() ? this.next().text : ''),
    );

    return this.parseType();
  }

  /** `func(string, ...[]any)`: the last parameter, taken out of `params`, if it is the rest. */
  protected restOf(params: ast.TypeNode[], names: string[]): ast.TypeNode | null {
    const at = names.findIndex((name) => name.startsWith('...'));

    if (at === -1) return null;
    if (at !== params.length - 1) {
      this.error(
        'the rest parameter is the last one, e.g. func(string, ...[]any)',
        params[at]!.start,
        params[at]!.end,
      );
    }

    names.splice(at, 1);

    return params.splice(at, 1)[0]!;
  }

  /**
   * `func(a, b number)`: as in Go, if a parameter has a name, all have, so `a` alone is a name that
   * shares the type of the next one. Without names, `func(A, B)` is a list of types.
   */
  protected groupParams(params: ast.TypeNode[], names: string[]): ast.TypeNode[] {
    // `...` alone, an unnamed rest parameter, gives no name.
    const named = (name: string) => name.replace(/^\.\.\./, '') !== '';

    if (!names.some(named)) return params;

    return params.map((param, i) => {
      if (names[i] !== '' || param.kind !== 'TypeReference' || param.typeArgs.length > 0) {
        return param;
      }

      const shared = names.findIndex((name, j) => j > i && named(name));

      if (shared === -1) {
        this.error(
          `parameter "${param.name.name}" has no type: write it after the name, e.g. func(a, b number)`,
          param.start,
          param.end,
        );

        return param;
      }

      names[i] = param.name.name;

      return params[shared]!;
    });
  }

  /** `paths []string` in `(paths []string) => Shape`: a name before the type of a parameter. */
  private startsNamedParam(): boolean {
    const next = this.peek(1);

    switch (next.kind) {
      case 'Identifier':
      case '?':
      case '{':
      case '(':
      case 'func':
      case 'chan':
      case '<-':
      case 'String':
      case 'Number':
        return true;

      // `x []number` is named.
      case '[':
        return this.peek(2).kind === ']';

      default:
        return false;
    }
  }

  /**
   * `load<number>(1)` would be two comparisons, `(load < number) > (1)`: a call takes no type
   * arguments, which are inferred, so the likely mistake is reported as one.
   */
  protected rejectTypeArguments(): void {
    const TYPE_TOKENS = new Set(['Identifier', ',', '[', ']', '?', '.', '|', 'chan']);
    let depth = 0;

    for (let offset = 0; ; offset++) {
      const { kind } = this.peek(offset);

      if (kind === '<') depth++;
      else if (kind === '>') depth--;
      else if (!TYPE_TOKENS.has(kind)) return;
      if (depth === 0) {
        if (this.peek(offset + 1).kind !== '(') return;
        break;
      }
    }

    this.fail(
      'a call takes no type arguments: they are inferred from the arguments and the expected type; give the variable a type instead, e.g. const done Promise<void> = new Promise(...)',
    );
  }
}
