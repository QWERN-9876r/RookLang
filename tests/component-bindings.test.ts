import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';

// Bound properties: `comp Tabs(bind active string)` may change `active`, and
// `<Tabs bind:active={tab} />` writes its changes into the parent's `tab`. Without `bind:` the
// property is the component's own state.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source, { markup: true });

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

const tabs = `comp Tabs(items []string, bind active string = "") {
    return <nav>
        {for item in items {
            <button aria-selected={item == active} onClick={active = item}>{item}</button>
        }}
    </nav>
}
`;

describe('syntax and types', () => {
  it('lets a component change a bound property', () => {
    expect(errors(tabs)).toEqual([]);
    // A parameter named bind stays one.
    expect(errors('func f(bind string) {\n}')).toEqual([]);
  });

  it.each([
    [
      'func f(bind x string) {\n}',
      'only the properties of components can be bound, e.g. comp Tabs(bind active string)',
    ],
    [
      'comp A(bind children Content) {\n    return <p />\n}',
      'children cannot be bound: it is the content between the tags',
    ],
    [
      `${tabs}comp A() {\n    return <Tabs items={[]} bind:active="a" />\n}`,
      '"bind:active" needs a variable in braces, e.g. bind:active={active}',
    ],
    [
      `${tabs}comp A() {\n    const tab = ""\n    return <Tabs items={[]} bind:active={tab} />\n}`,
      'cannot assign to "tab": it is a constant',
    ],
    [
      `${tabs}comp A() {\n    state tab = 1\n    return <Tabs items={[]} bind:active={tab} />\n}`,
      'cannot bind number to "active" of <Tabs>, which is string',
    ],
    [
      `${tabs}comp A() {\n    state tab = ""\n    return <Tabs bind:items={tab} />\n}`,
      '"items" of <Tabs> is not bound: the component declares it with bind to change it, e.g. comp Tabs(bind items ...)',
    ],
    [
      `${tabs}comp A() {\n    state tab = ""\n    return <Tabs items={[]} active="a" bind:active={tab} />\n}`,
      'duplicate property "active"',
    ],
    [
      `${tabs}comp A() {\n    state tab = ""\n    const Shown comp(items []string, active ?string) = Tabs\n    return <Shown items={[]} bind:active={tab} />\n}`,
      '<Shown> takes its component from a value, so it cannot bind its properties; pass a function, e.g. onChange={...}',
    ],
    [
      'comp A(n number) {\n    return <button onClick={n++}>{n}</button>\n}',
      'cannot assign to "n": component properties are read-only; to change it, declare it with bind, e.g. comp A(bind n ...)',
    ],
  ])('reports %j', (source, message) => {
    expect(errors(source)).toEqual([message]);
  });
});

describe('running', () => {
  it('writes the changes into the variable of the parent, which updates both', () => {
    const { body } = mountWithDom(`${tabs}comp App() {
    state tab = "a"
    return <main>
        <Tabs items={["a", "b"]} bind:active={tab} />
        <p>{tab}</p>
        <button onClick={tab = "a"}>reset</button>
    </main>
}
document.body.append(<App />)
`);

    body.find('button', 1).click();
    expect(String(body.find('p'))).toBe('<p>b</p>');
    expect(body.find('button', 1).attributes.get('aria-selected')).toBe('true');
    body.find('button', 2).click();
    expect(body.find('button', 0).attributes.get('aria-selected')).toBe('true');
    expect(body.find('button', 1).attributes.get('aria-selected')).toBe('false');
  });

  it('is the state of the component without bind:', () => {
    const { body } =
      mountWithDom(`${tabs}document.body.append(<Tabs items={["a", "b"]} active="a" />, <Tabs items={["c"]} />)
`);

    body.find('button', 1).click();
    expect(body.find('button', 1).attributes.get('aria-selected')).toBe('true');
    expect(body.find('button', 2).attributes.get('aria-selected')).toBe('false');
  });

  it('passes changes in place to the parent', () => {
    const { body } = mountWithDom(`comp Adder(bind items []string) {
    return <button onClick={items.push("x")}>add {items.length}</button>
}
comp App() {
    state items []string = []
    return <main>
        <Adder bind:items={items} />
        <p>{items.length}</p>
    </main>
}
document.body.append(<App />)
`);

    body.find('button').click();
    body.find('button').click();
    expect(String(body.find('main'))).toBe('<main><button>add 2</button><p>2</p></main>');
  });

  it('binds a field of a list item', () => {
    const { body } = mountWithDom(`interface Todo {
    title string
    done bool
}
comp Check(bind on bool, label string) {
    return <label><input type="checkbox" bind:checked={on} />{label}</label>
}
comp App() {
    state todos []Todo = [{ title: "a", done: false }, { title: "b", done: true }]
    derived left = todos.filter(todo => !todo.done).length
    return <main>
        {for todo in todos {
            <Check bind:on={todo.done} label={todo.title} />
        }}
        <p>{left}</p>
    </main>
}
document.body.append(<App />)
`);
    const first = body.find('input');

    first.checked = true;
    first.dispatch('change');
    expect(String(body.find('p'))).toBe('<p>0</p>');
  });

  it('works with a component that becomes a function', () => {
    // A recursive component is a function.
    const { body } = mountWithDom(`comp Counter(bind count number = 0, depth number = 0) {
    return <span>
        <button onClick={count++}>{count}</button>
        {if depth < 0 {
            <Counter depth={depth + 1} />
        }}
    </span>
}
comp App() {
    state total = 5
    return <main>
        <Counter bind:count={total} />
        <Counter />
        <p>{total}</p>
    </main>
}
document.body.append(<App />)
`);

    body.find('button').click();
    body.find('button', 1).click();
    expect(String(body.find('main'))).toBe(
      '<main><span><button>6</button></span><span><button>1</button></span><p>6</p></main>',
    );
  });
});
