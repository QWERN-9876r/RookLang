import { describe, expect, it } from 'vitest';
import type * as ast from '../src/ast.ts';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';

// `{for todo in todos with key todo.id { ... }}`: the blocks of a list are found again by the key
// instead of the item itself, so a list whose items are replaced by new objects with the same keys,
// as one loaded again from a server, keeps its blocks and the state of the components in them.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

const todo = `interface Todo {
    id number
    title string
    done bool
}
`;

/** A component with a list of todos, keyed by `key`, in markup that changes. */
const list = (key: string) => `${todo}comp List() {
    state todos []Todo = []
    return <ul>{for todo in todos with key ${key} { <li>{todo.title}</li> }}</ul>
}`;

describe('syntax', () => {
  it('reads the key after the items, with and key being words only there', () => {
    const { program, diagnostics } = parse(`${list('todo.id')}
const with = 1
const key = with`);

    expect(diagnostics).toEqual([]);

    const component = program.body[1] as ast.ComponentDeclaration;
    const result = component.body.body.at(-1) as ast.ReturnStatement;
    const ul = result.values[0] as ast.ElementExpression;
    const loop = (ul.children[0] as ast.JsxStatementContainer).statement as ast.ForInStatement;

    expect(loop.withKey).toMatchObject({ kind: 'MemberExpression', property: { name: 'id' } });
  });

  it.each([
    ['for x in [1, 2] with key x {\n    console.log(x)\n}', 'a loop outside markup'],
    ['async func f(xs []number) {\n    go for i, x in xs with key x {\n    }\n}', 'go for'],
  ])('rejects a key where there are no blocks: %s', (source) => {
    expect(errors(source)).toContain(
      '"with key" finds again the blocks of a {for} in markup, and this loop has none: remove it',
    );
  });
});

describe('type checking', () => {
  it.each(['todo.id', 'todo.title', '`${todo.id}-${todo.title}`'])('takes %s as a key', (key) => {
    expect(errors(list(key))).toEqual([]);
  });

  it.each([
    ['todo.done', 'bool'],
    ['todo', 'Todo'],
  ])('rejects %s as a key', (key, type) => {
    expect(errors(list(key))).toEqual([
      `the key of a list must be a string or a number, not ${type}: e.g. "with key todo.id"`,
    ]);
  });
});

describe('code generation', () => {
  it('passes the key to $$list and the new item to the block that stays', () => {
    const { code, diagnostics } = compile(`${list('todo.id')}\ndocument.body.append(<List />)`);

    expect(diagnostics).toEqual([]);
    expect(code).toContain('}, (todo) => todo.id);');
    expect(code).toContain('($$index, $$item) => {');
    expect(code).toContain('todo = $$item;');
  });
});

describe('runtime behavior', () => {
  const program = (key: string) => `${todo}comp Row(title string) {
    state clicks = 0
    return <li onClick={clicks++}>{title}: {clicks}</li>
}
comp List() {
    state todos []Todo = [{ id: 1, title: "a", done: false }, { id: 2, title: "b", done: false }]
    return <div>
        <button onClick={todos = [
            { id: 2, title: "B", done: true },
            { id: 1, title: "a", done: false },
            { id: 3, title: "c", done: false },
        ]}>reload</button>
        <ul>{for todo in todos${key} {
            <Row title={todo.title} />
        }}</ul>
    </div>
}
document.body.append(<List />)`;

  it('keeps the blocks of the items whose keys stay, and gives them the new items', () => {
    const { body } = mountWithDom(program(' with key todo.id'));
    const first = body.find('li');

    first.click();
    expect(String(body.find('ul'))).toBe('<ul><li>a: 1</li><li>b: 0</li></ul>');
    body.find('button').click();
    expect(String(body.find('ul'))).toBe('<ul><li>B: 0</li><li>a: 1</li><li>c: 0</li></ul>');
    expect(body.find('li', 1)).toBe(first);
  });

  it('creates every block again without a key, since the items are new objects', () => {
    const { body } = mountWithDom(program(''));
    const first = body.find('li');

    first.click();
    body.find('button').click();
    expect(String(body.find('ul'))).toBe('<ul><li>B: 0</li><li>a: 0</li><li>c: 0</li></ul>');
    expect(body.find('li', 1)).not.toBe(first);
  });
});
