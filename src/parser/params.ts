import type * as ast from '../ast.ts';
import { JumpParser } from './jumps.ts';
import { VISIBILITIES } from './syntax.ts';

// The parameters of functions, constructors and components, with their modifiers, and the results
// of functions.

export abstract class ParamParser extends JumpParser {
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
}
