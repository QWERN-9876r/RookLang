import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { mountWithDom } from './fake-dom.ts';

// Elements are created with $$element of the runtime, which takes the attributes they have from
// the start.

function js(source: string): string {
  const { code, diagnostics } = compile(source);

  expect(diagnostics).toEqual([]);

  return code;
}

describe('the element helper', () => {
  it('creates every element', () => {
    const code = js('document.body.append(<div id="app"><p>Hi</p></div>)');

    expect(code).toContain('const $$div1 = $$element("div", { id: "app" });');
    expect(code).toContain('const $$p2 = $$element("p");');
    expect(code).toContain('import { $$element } from "rooklang/runtime";');
    expect(code).not.toContain('document.createElement');
  });

  it('takes properties and attributes; the rest are statements after it', () => {
    const code = js(
      `const label = "Close"
const note ?string = null
const extra = { title: "x" }
document.body.append(<button
    type="button"
    aria-label={label}
    disabled
    data-id="7"
    aria-describedby={note}
    style="color: red"
    onClick={console.log(1)}
    {...extra}
    id="after"
>x</button>)`,
    );

    expect(code).toContain(
      'const $$button1 = $$element("button", { type: "button", disabled: true }, { "aria-label": label, "data-id": "7" });',
    );
    expect(code).toContain('if (note != null) $$button1.setAttribute("aria-describedby", note);');
    expect(code).toContain('$$button1.style.cssText = "color: red";');
    expect(code).toContain('$$button1.addEventListener("click"');
    // A spread may override what comes before it, and what comes after it overrides the spread.
    expect(code).toContain('Object.assign($$button1, extra);\n$$button1.id = "after";');
  });

  it('creates SVG elements with their attributes', () => {
    const code = js('document.body.append(<svg viewBox="0 0 8 8"><path d="M0 0" /></svg>)');

    expect(code).toContain('const $$svg1 = $$svgElement("svg", { viewBox: "0 0 8 8" });');
    expect(code).toContain('const $$path2 = $$svgElement("path", { d: "M0 0" });');
    expect(code).toContain('import { $$svgElement } from "rooklang/runtime";');
  });

  it('creates the element of a ref with its constant attributes', () => {
    const code = js(
      `comp Search(hint string) {
    ref input
    input.focus()
    return <label>Find <input ref={input} type="search" class="field" placeholder={hint} /></label>
}
document.body.append(<Search hint="Fruit" />)`,
    );

    expect(code).toContain(
      'const input = $$element("input", { type: "search", className: "field" });\n  input.focus();',
    );
    expect(code).toContain('input.placeholder = hint;');
  });

  it('builds the same DOM and updates it the same way', () => {
    const source = `comp Panel(title string, ...attrs) {
    state open = false
    state count = 0
    style {
        .panel { padding: 4px; }
    }
    return <section class="panel" aria-label={title} {...attrs}>
        <h2 class={open ? "open" : "closed"} title={title} data-count={count}>{title}</h2>
        <button disabled={open} onClick={open = !open; count++}>Toggle</button>
        <svg viewBox="0 0 8 8"><path d={open ? "M0 0" : "M8 8"} /></svg>
        <p>{count}</p>
    </section>
}
document.body.append(<div id="app"><Panel title="A" class="wide" hidden /></div>)`;
    const plain = mountWithDom(source);
    const helped = mountWithDom(source);

    expect(js(source)).toContain('$$element("section"');
    expect(String(helped.body)).toBe(String(plain.body));
    expect(String(plain.body)).toContain('wide');

    plain.body.find('button').click();
    helped.body.find('button').click();
    expect(String(helped.body)).toBe(String(plain.body));
    expect(String(plain.body)).toContain('data-count=1');
  });
});
