import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';
import { rook } from '../src/vite.ts';
import { mountJsWithDom, mountWithDom } from './fake-dom.ts';
import { markupProject } from './project.ts';

// State of a module, `state items []Item = []` at its top level: the components that read it are
// updated when it changes anywhere in its module. Other modules read it and change it only with
// the functions of its module.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source, { markup: true });

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

const cart = `export interface Item {
    name string
    done bool
}

export state items []Item = []

export func add(name string) {
    items.push({ name: name, done: false })
}

export func toggle(name string) {
    for item in items {
        if item.name == name {
            item.done = !item.done
        }
    }
}
`;

/** Writes the files to a new directory. */
function project(files: Record<string, string>): string {
  const dir = markupProject('rook-shared-');

  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);

  return dir;
}

function compileIn(dir: string, name: string) {
  const filename = join(dir, name);

  return compile(readFileSync(filename, 'utf8'), { filename });
}

const moduleErrors = (main: string) =>
  compileIn(project({ 'cart.rk': cart, 'main.rk': main }), 'main.rk').diagnostics.map(
    (d) => d.message,
  );

describe('syntax and types', () => {
  it('declares state at the top level of a module', () => {
    expect(errors(cart)).toEqual([]);
    expect(errors('func f() {\n    state count = 0\n}')).toEqual([
      'state can only be declared inside a component or at the top level of a module',
    ]);
    expect(parse('state count = 0', { markup: false }).diagnostics.map((d) => d.message)).toEqual([
      'state of a module is off: turn on markup and components with "rook": { "markup": true } in package.json, or with --markup',
    ]);
  });

  it('lets other modules read it and change it only with the functions of its module', () => {
    const imported = 'import { items, add } from "./cart.rk"\n';
    const readOnly =
      '"items" is state of "./cart.rk", which is read-only here; change it with a function that "./cart.rk" exports';

    expect(moduleErrors(`${imported}add("a")\nconsole.log(items.length)`)).toEqual([]);
    expect(moduleErrors(`${imported}items = []`)).toEqual([readOnly]);
    expect(moduleErrors(`${imported}items.push({ name: "a", done: false })`)).toEqual([readOnly]);
    expect(moduleErrors(`${imported}items[0].done = true`)).toEqual([readOnly]);
  });

  it('keeps an exported decorator from reading state of its module', () => {
    expect(errors('state count = 0\nexport dec counted() {\n    console.log(count)\n}')).toEqual([
      '@counted is exported, so its code cannot read "count", state of its module, yet: read it in a component of the module and pass it to @counted as an argument',
    ]);
  });
});

describe('running', () => {
  const store = `state items []string = []
state total = 0

func add(name string) {
    items.push(name)
    total++
}

func last() string {
    return items.pop() ?? ""
}
`;

  it('updates every component that reads it, from functions of the module', () => {
    const { body } = mountWithDom(`${store}comp Count() {
    return <b>{items.length}</b>
}
comp List() {
    return <ul>{for item in items { <li>{item}</li> }}</ul>
}
comp App() {
    return <main>
        <button onClick={add("a")}>add</button>
        <button onClick={console.log(last())}>pop</button>
        <Count />
        <List />
        <i>{total}</i>
    </main>
}
document.body.append(<App />)
`);

    body.find('button').click();
    body.find('button').click();
    expect(String(body.find('main'))).toContain('<b>2</b><ul><li>a</li><li>a</li></ul><i>2</i>');
    body.find('button', 1).click();
    expect(String(body.find('main'))).toContain('<b>1</b><ul><li>a</li></ul>');
  });

  it('sees changes through the names that refer into it, and in bind:', () => {
    const { body } = mountWithDom(`interface Todo {
    title string
    done bool
}
state todos []Todo = [{ title: "a", done: false }]
state draft = ""

func finish() {
    for todo in todos {
        todo.done = true
    }
}

comp Left() {
    return <b>{todos.filter(todo => !todo.done).length}</b>
}
comp App() {
    return <main>
        <input bind:value={draft} />
        <button onClick={finish()}>finish</button>
        <Left />
        <i>{draft}</i>
    </main>
}
document.body.append(<App />)
`);
    const input = body.find('input');

    body.find('button').click();
    expect(String(body.find('b'))).toBe('<b>0</b>');
    input.value = 'x';
    input.dispatch('input');
    expect(String(body.find('i'))).toBe('<i>x</i>');
  });

  it('stops updating a component that {if} removed', () => {
    const { body, output } = mountWithDom(`state count = 0
comp Shown() {
    effect {
        console.log("count", count)
    }
    return <b>{count}</b>
}
comp App() {
    state open = true
    return <main>
        <button onClick={count++}>+</button>
        <button onClick={open = !open}>toggle</button>
        {if open {
            <Shown />
        }}
    </main>
}
document.body.append(<App />)
`);

    body.find('button').click();
    body.find('button', 1).click();
    body.find('button').click();
    expect(output).toEqual(['count 0', 'count 1']);
  });

  it('works when Vite bundles the modules', async () => {
    const dir = project({
      'index.html': '<script type="module" src="./main.rk"></script>',
      'cart.rk': cart,
      'badge.rk': `import { items } from "./cart.rk"

export comp Badge() {
    return <b>{items.filter(item => !item.done).length}</b>
}
`,
      'main.rk': `import { add, items, toggle } from "./cart.rk"
import { Badge } from "./badge.rk"

comp App() {
    return <main>
        <button onClick={add("a")}>add</button>
        <button onClick={toggle("a")}>toggle</button>
        <Badge />
        <i>{items.length}</i>
    </main>
}

document.body.append(<App />)
`,
    });

    await build({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [rook()],
      build: { outDir: join(dir, 'dist'), minify: false, modulePreload: { polyfill: false } },
    });

    const assets = join(dir, 'dist', 'assets');
    const [bundle] = readdirSync(assets).filter((name) => name.endsWith('.js'));
    const { body } = mountJsWithDom(readFileSync(join(assets, bundle!), 'utf8'));

    body.find('button').click();
    expect(String(body.find('main'))).toContain('<b>1</b><i>1</i>');
    body.find('button', 1).click();
    expect(String(body.find('main'))).toContain('<b>0</b><i>1</i>');
  });
});
