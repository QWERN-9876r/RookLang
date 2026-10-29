import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';

// Values of attributes that save a conditional: a list of classes, `class={[a, on ? b : null]}`,
// and a bool in `aria-*`, which becomes "true" or "false".

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

describe('a list of classes', () => {
  it('takes strings and nulls', () => {
    expect(
      errors(`comp A(on bool, extra []string) {
    return <div class={["tab", on ? "on" : null]}>
        <p class={extra} />
    </div>
}`),
    ).toEqual([]);
    expect(errors('comp A() {\n    return <p class={["tab", 1]} />\n}')).toEqual([
      'cannot use number as ?string',
    ]);
    expect(errors('comp A(flags []bool) {\n    return <p class={flags} />\n}')).toEqual([
      'cannot use []bool as []?string for attribute "class"',
    ]);
  });

  it('joins the classes that are given and follows the state', () => {
    const { body } = mountWithDom(`comp Tab() {
    state on = false
    return <button class={["tab", on ? "on" : null, ""]} onClick={on = !on}>tab</button>
}
document.body.append(<Tab />)
`);

    expect(String(body)).toBe('<body><button className=tab>tab</button></body>');
    body.find('button').click();
    expect(String(body)).toBe('<body><button className=tab on>tab</button></body>');
  });

  it('adds the class of the style and sets the class of SVG elements', () => {
    const { body } = mountWithDom(`comp Icon() {
    state big = true
    style {
        svg { width: 1em }
    }
    return <svg class={["icon", big ? "big" : null]} onClick={big = false} />
}
document.body.append(<Icon />)
`);
    const svg = body.find('svg');

    expect(svg.attributes.get('class')).toMatch(/^icon big rook-icon-\w+$/);
    svg.click();
    expect(svg.attributes.get('class')).toMatch(/^icon rook-icon-\w+$/);
  });
});

describe('a bool in aria-*', () => {
  it('becomes "true" or "false"', () => {
    const { body } = mountWithDom(`comp Toggle() {
    state on = false
    return <button aria-pressed={on} onClick={on = !on}>toggle</button>
}
document.body.append(<Toggle />)
`);

    expect(String(body)).toBe('<body><button aria-pressed=false>toggle</button></body>');
    body.find('button').click();
    expect(String(body)).toBe('<body><button aria-pressed=true>toggle</button></body>');
  });
});
