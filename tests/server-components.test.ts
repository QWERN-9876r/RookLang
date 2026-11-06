import { describe, expect, it } from 'vitest';
import { runOnServer, serverErrors, serverJs } from './server.ts';

// Components on the server: async functions of their properties and the context, which return
// any value; a tag of a component is its use, and waits for it (docs/server.md).

describe('components as functions', () => {
  it('compile to async functions of the properties and the context', () => {
    const code = serverJs(`
      comp Card(title string, kind string = "info") {
          return <h2 class={kind}>{title}</h2>
      }
      console.log(<Card title="A" />)
    `);

    expect(code).toContain('async function $$Card({ title, kind = "info" }, $$ctx) {');
    expect(code).toContain('console.log(await $$Card({ title: "A" }, {}));');
  });

  it('render their markup with the properties and their default values', async () => {
    expect(
      await runOnServer(`
        comp Card(title string, kind string = "info", note ?string) {
            return <section class={kind}>
                <h2>{title}</h2>
                {if note != null { <p>{note}</p> }}
            </section>
        }
        console.log(<main><Card title="A" /><Card title="B & C" kind="warn" note="n" /></main>)
      `),
    ).toEqual([
      '<main><section class="info"><h2>A</h2></section><section class="warn"><h2>B &amp; C</h2><p>n</p></section></main>',
    ]);
  });

  it('may wait in their bodies, and end with defer', async () => {
    expect(
      await runOnServer(`
        async func load(id number) string {
            return \`user \${id}\`
        }
        comp User(id number) {
            defer console.log("closed", id)
            const name = await load(id)
            return <li>{name}</li>
        }
        console.log(<ul><User id={1} /></ul>)
      `),
    ).toEqual(['closed 1', '<ul><li>user 1</li></ul>']);
  });

  it('run side by side when their tags are', async () => {
    expect(
      await runOnServer(`
        comp Slow(name string, ms number) {
            console.log("start", name)
            <-after(ms)
            console.log("end", name)
            return <b>{name}</b>
        }
        console.log(<p><Slow name="a" ms={20} /><Slow name="b" ms={1} /></p>)
      `),
    ).toEqual(['start a', 'start b', 'end b', 'end a', '<p><b>a</b><b>b</b></p>']);
  });

  it('render children only where the component puts them', async () => {
    expect(
      await runOnServer(`
        comp Note() {
            console.log("note rendered")
            return <i>note</i>
        }
        comp Layout(title string, children Content) {
            return <article><h1>{title}</h1>{children}</article>
        }
        comp Hidden(show bool, children Content) {
            return <div>{if show { <>{children}</> }}</div>
        }
        console.log(<Layout title="T"><p>text</p><Note /></Layout>)
        console.log(<Hidden show={false}><Note /></Hidden>)
      `),
    ).toEqual([
      'note rendered',
      '<article><h1>T</h1><p>text</p><i>note</i></article>',
      '<div></div>',
    ]);
  });

  it('render in {for} and in branches of ?:', async () => {
    expect(
      await runOnServer(`
        comp Item(n number) {
            return <li>{n * 2}</li>
        }
        const wide = true
        console.log(<ul>{for n in [1, 2, 3] { <Item n={n} /> }}</ul>)
        console.log(<div>{wide ? <Item n={5} /> : null}</div>)
      `),
    ).toEqual(['<ul><li>2</li><li>4</li><li>6</li></ul>', '<div><li>10</li></div>']);
  });

  it('may return early and use themselves', async () => {
    expect(
      await runOnServer(`
        interface Node {
            name string
            children []Node
        }
        comp Tree(node Node) Html {
            if node.children.length == 0 {
                return <li>{node.name}</li>
            }
            return <li>{node.name}<ul>{for child in node.children { <Tree node={child} /> }}</ul></li>
        }
        const root Node = { name: "a", children: [{ name: "b", children: [] }] }
        console.log(<Tree node={root} />)
      `),
    ).toEqual(['<li>a<ul><li>b</li></ul></li>']);
  });
});

describe('the result of a component', () => {
  it('is any value, inferred from the returns or written after the properties', () => {
    const source = `
      interface User {
          name string
      }
      comp Users() []User {
          return [{ name: "Ann" }]
      }
      comp Count() {
          return 3
      }
    `;

    expect(
      serverErrors(`${source}\nconst users []User = <Users />\nconst n number = <Count />`),
    ).toEqual([]);
    expect(serverErrors(`${source}\nconst n string = <Count />`)).toEqual([
      'cannot use number as string',
    ]);
    expect(serverErrors('comp Bad() number {\n    return "x"\n}')).toEqual([
      'cannot use string as number in return',
    ]);
  });

  it('is the value the tag gives', async () => {
    expect(
      await runOnServer(`
        comp Total(items []number) number {
            return items.reduce((sum, n) => sum + n, 0)
        }
        const total = <Total items={[1, 2, 3]} />
        console.log(total + 1)
      `),
    ).toEqual(['7']);
  });

  it('is not markup unless it is Html, text, a number or a Response', () => {
    expect(
      serverErrors(`
        interface User {
            name string
        }
        comp Users() []User {
            return [{ name: "Ann" }]
        }
        const page = <main><Users /></main>
      `),
    ).toEqual([
      'a component of type []User cannot be in markup; return it, or show its fields, e.g. {user.name}',
    ]);
  });

  it('is written for a component that uses itself', () => {
    expect(
      serverErrors(
        'comp Tree(depth number) {\n    if depth == 0 {\n        return <i />\n    }\n    return <b><Tree depth={depth - 1} /></b>\n}',
      ),
    ).toEqual([
      '"Tree" uses itself, so it writes the type of its result after the properties, e.g. comp Tree(depth number) Html',
    ]);
  });

  it('is waited for only where code may wait', () => {
    expect(
      serverErrors(
        'comp Card() {\n    return <p />\n}\nfunc page() Html {\n    return <main><Card /></main>\n}',
      ),
    ).toEqual([
      '<Card /> waits for the component: use it in a component, an async function or at the top level of a module',
    ]);
  });
});
