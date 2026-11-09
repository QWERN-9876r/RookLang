import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile as compileInBrowser } from '../src/browser.ts';
import { markupFor } from '../src/config.ts';
import { runOnServer, serverErrors, serverJs } from './server.ts';

// Markup on the server: "rook": { "markup": "html" } makes markup a string of HTML, of the type
// Html, with the same tags and checks as in the browser (docs/server.md, "Markup as HTML").

describe('turning it on', () => {
  it('is a setting of the package, and true still means the markup of the browser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rook-html-'));

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ rook: { markup: 'html' } }));
    expect(markupFor(join(dir, 'app.rk'))).toBe('html');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ rook: { markup: true } }));
    expect(markupFor(join(dir, 'app.rk'))).toBe(true);
  });

  it('is an option of the browser compiler', () => {
    const { code, diagnostics } = compileInBrowser('const p = <p>Hi</p>', null, {
      markup: 'html',
    });

    expect(diagnostics).toEqual([]);
    expect(code).toContain('$$html`<p>Hi</p>`');
  });
});

describe('markup as a string of HTML', () => {
  it('is a template of $$html, not DOM elements', () => {
    const code = serverJs(
      'const name = "Ann"\nconst link = <a href="/" class="nav">Hi, {name}</a>',
    );

    expect(code).toContain('const link = $$html`<a href="/" class="nav">Hi, ${name}</a>`;');
    expect(code).not.toContain('$$element');
  });

  it('escapes text and the values of attributes, but not Html', async () => {
    expect(
      await runOnServer(`
        const name = "Ann & <Bob>"
        const quote = "say \\"hi\\""
        const inner = <b>{name}</b>
        console.log(<p title={quote}>{name} {inner}</p>)
      `),
    ).toEqual([
      '<p title="say &quot;hi&quot;">Ann &amp; &lt;Bob&gt; <b>Ann &amp; &lt;Bob&gt;</b></p>',
    ]);
  });

  it('keeps what the template literal of JS would read as it is written', async () => {
    expect(await runOnServer('console.log(<p class="a`b">${"x"} \\ `</p>)')).toEqual([
      '<p class="a`b">$x \\ `</p>',
    ]);
  });

  it('writes attributes by their values: bool, null, numbers and lists of classes', async () => {
    expect(
      await runOnServer(`
        const off = false
        const on = true
        console.log(<input disabled={off} required={on} value={"3"} />)
        console.log(<div class={["tab", on ? "active" : null, ""]} aria-hidden={on}></div>)
        console.log(<button disabled>Go</button>)
      `),
    ).toEqual([
      '<input required value="3">',
      '<div class="tab active" aria-hidden="true"></div>',
      '<button disabled>Go</button>',
    ]);
  });

  it('writes void elements without a closing tag, and others with one', async () => {
    expect(await runOnServer('console.log(<div><br /><img src="a.png" /><span /></div>)')).toEqual([
      '<div><br><img src="a.png"><span></span></div>',
    ]);
  });

  it('puts the doctype before <html>', async () => {
    expect(
      await runOnServer('console.log(<html><head><title>A</title></head><body></body></html>)'),
    ).toEqual(['<!doctype html><html><head><title>A</title></head><body></body></html>']);
  });

  it('writes fragments, arrays, numbers and null as children', async () => {
    expect(
      await runOnServer(`
        const items = ["a", "b"]
        const nothing ?string = null
        console.log(<><i>{1}</i>{items}{nothing}</>)
      `),
    ).toEqual(['<i>1</i>ab']);
  });

  it('writes SVG with the tags as written', async () => {
    expect(
      await runOnServer('console.log(<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" /></svg>)'),
    ).toEqual(['<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"></circle></svg>']);
  });

  it('runs {if}, {for} and {switch} once, with const in their blocks', async () => {
    expect(
      await runOnServer(`
        const items = ["a", "b", "c"]
        const kind string = "ok"
        console.log(<ul>{for i, item in items {
            const label = item.toUpperCase()
            if i != 1 {
                <li>{label}</li>
            }
        }}</ul>)
        console.log(<p>{if items.length > 5 { <b>many</b> } else { <i>few</i> }}</p>)
        console.log(<p>{switch kind {
        case "ok":
            <b>fine</b>
        default:
            <b>bad</b>
        }}</p>)
      `),
    ).toEqual(['<ul><li>A</li><li>C</li></ul>', '<p><i>few</i></p>', '<p><b>fine</b></p>']);
  });

  it('gives the type Html, which is not a string', () => {
    expect(serverErrors('const p Html = <p />')).toEqual([]);
    expect(serverErrors('const s string = <p />')).toEqual(['cannot use Html as string']);
    expect(serverErrors('const p Html = "<p>"')).toEqual(['cannot use string as Html']);
  });

  it('checks attributes by the DOM, as in the browser', () => {
    expect(serverErrors('const i = <input value={[1]} />')).toEqual([
      'cannot use number[] as string for attribute "value"',
    ]);
  });

  it('takes strings, numbers, Html, arrays and null as children, and nothing else', () => {
    expect(serverErrors('const o = { a: 1 }\nconst p = <p>{o}</p>')).toEqual([
      'cannot use { a number } as element content: on the server it is Html, a string, a number, an array of them or null',
    ]);
    expect(serverErrors('const p = <p>{true}</p>')).toEqual([
      'cannot use bool as element content: use a condition, e.g. {ok ? <b>yes</b> : null}',
    ]);
  });
});

describe('what the server has not', () => {
  it('reports handlers, bind:, ref and the state of components', () => {
    expect(serverErrors('const b = <button onClick={console.log("x")}>x</button>')).toEqual([
      '"onClick" has no meaning on the server: markup there is a string; make a client component with @html-tag for code that runs in the browser',
    ]);
    expect(
      serverErrors('comp Field() {\n    let text = ""\n    return <input bind:value={text} />\n}'),
    ).toEqual([
      '"bind:value" has no meaning on the server: markup there is a string, and nothing changes it',
    ]);
    expect(
      serverErrors('comp Counter() {\n    state count = 0\n    return <b>{count}</b>\n}'),
    ).toEqual([
      '"state" has no meaning on the server: a component runs once for a request; use let or const',
    ]);
    expect(serverErrors('comp Box() {\n    ref box\n    return <div ref={box} />\n}')).toContain(
      '"ref" has no meaning on the server: there are no elements, only a string of HTML',
    );
    expect(
      serverErrors(
        'comp Box() {\n    mount {\n        console.log(1)\n    }\n    return <div />\n}',
      ),
    ).toEqual([
      '"mount" has no meaning on the server: there is nothing to mount; use defer to clean up',
    ]);
  });

  it('reports state of the module, which all requests would share', () => {
    expect(serverErrors('state visits = 0')).toEqual([
      'state of a module would be shared by all requests on the server: use let for what they share on purpose, or pass it down',
    ]);
  });

  it('reports @html-tag, which makes a component of the browser', () => {
    expect(serverErrors('@html-tag("app-card")\ncomp Card() {\n    return <p />\n}')).toEqual([
      '@html-tag makes a component of the browser: write it in a package with "rook": { "markup": true }',
    ]);
  });
});
