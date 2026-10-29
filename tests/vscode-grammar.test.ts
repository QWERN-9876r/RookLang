import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as textmate from 'vscode-textmate';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGrammar, root, scopeOf, scopesOf, tokenize } from './textmate.ts';

// The VS Code extension in editors/vscode: its grammar is run by the same engine that VS Code uses.

beforeAll(loadGrammar);

describe('VS Code grammar', () => {
  it('colours declarations, keywords and types', () => {
    const source = 'func divide(a, b number) (number, error) {\n    return 0, error("x")\n}';

    expect(scopeOf(source, 'func')).toBe('storage.type.function');
    expect(scopeOf(source, 'divide')).toBe('entity.name.function');
    expect(scopesOf(source, 'number')).toEqual([
      'support.type.primitive',
      'support.type.primitive',
    ]);
    expect(scopesOf(source, 'error')).toEqual(['support.type.primitive', 'support.function']);
    expect(scopeOf(source, 'return')).toBe('keyword.control.flow');
    expect(scopeOf(source, '0')).toBe('constant.numeric.decimal');
  });

  it('colours bigints, bytes and iterators', () => {
    expect(scopesOf('let big bigint = 10n * 0xffn', 'bigint')).toEqual(['support.type.primitive']);
    expect(scopeOf('let big = 10n * 0xffn', '10n')).toBe('constant.numeric.decimal');
    expect(scopeOf('let big = 10n * 0xffn', '0xffn')).toBe('constant.numeric.hex');
    expect(scopeOf('let data []byte = []byte("guava")', 'byte')).toBe('support.type.primitive');
    expect(scopeOf('const xs = make([]float64, n)', 'float64')).toBe('support.type.primitive');
    expect(scopeOf('let ids []uint32', 'uint32')).toBe('support.type.primitive');
    expect(scopeOf('const int32s = 1', 'int32s')).not.toBe('support.type.primitive');

    const iterator = 'func count(yield func(number) bool) {';

    expect(scopeOf(iterator, 'count')).toBe('entity.name.function');
    expect(scopesOf(iterator, 'bool')).toEqual(['support.type.primitive']);
  });

  it('colours components, classes and type declarations', () => {
    expect(scopeOf('comp Counter(initialValue number) {', 'Counter')).toBe(
      'entity.name.type.component',
    );

    const header = 'class Admin extends User implements Shape {';

    expect(scopesOf(header, 'class')).toEqual(['storage.type.class']);
    expect(scopeOf(header, 'Admin')).toBe('entity.name.type.class');
    expect(scopeOf(header, 'User')).toBe('entity.other.inherited-class');
    expect(scopeOf(header, 'implements')).toBe('storage.modifier');
    expect(scopeOf('interface Todo {', 'Todo')).toBe('entity.name.type');
    expect(scopeOf('let items []Todo', 'Todo')).toBe('entity.name.type');
    expect(scopeOf('let user ?User = null', '?')).toBe('keyword.operator.type.nullable');
    expect(scopeOf('const x = ok ? a : b', '?')).toBe('keyword.operator.ternary');
    expect(scopeOf('const MAX_TITLE = 80', 'MAX_TITLE')).toBe('variable.other.constant');
  });

  it('colours generic declarations and grouped types', () => {
    const header = 'class Stack<T> extends Base implements Source<T> {';

    expect(scopeOf(header, 'Stack')).toBe('entity.name.type.class');
    expect(scopesOf(header, 'T')).toEqual(['entity.name.type', 'entity.name.type']);
    expect(scopeOf(header, 'Base')).toBe('entity.other.inherited-class');
    expect(scopeOf(header, 'implements')).toBe('storage.modifier');

    const func = 'func first<T any>(xs []T) ?T {';

    expect(scopeOf(func, 'first')).toBe('entity.name.function');
    expect(scopeOf(func, 'any')).toBe('support.type.primitive');

    // Type arguments are not markup: `<number>` is a type.
    const typed = 'let b Box<Box<number>> = chan<Box<number>>(1)';

    expect(scopesOf(typed, 'Box')).toEqual(Array(3).fill('entity.name.type'));
    expect(scopesOf(typed, 'number')).toEqual(Array(2).fill('support.type.primitive'));
    expect(scopeOf('let x ?(A | B) = null', '?')).toBe('keyword.operator.type.nullable');
    expect(scopeOf('let xs [](A | B)', '[]')).toBe('punctuation.definition.type.array');
  });

  it('tells object keys from the ternary operator', () => {
    const source = 'const f = { id: "all", label: ok ? a : b }';

    expect(scopesOf(source, 'id')).toEqual(['meta.object-literal.key']);
    expect(scopesOf(source, ':')).toEqual([
      'punctuation.separator.key-value',
      'punctuation.separator.key-value',
      'keyword.operator.ternary',
    ]);
    expect(scopeOf('switch x {\ncase 1:\ndefault:\n}', 'default')).toBe(
      'keyword.control.conditional',
    );
  });

  it('colours @html-tag', () => {
    const source = '@html-tag("app-card") comp Card() {';

    expect(scopeOf(source, '@')).toBe('punctuation.decorator');
    expect(scopeOf(source, 'html-tag')).toBe('entity.name.function.decorator');
    expect(scopeOf(source, '"')).toBe('punctuation.definition.string.begin');
  });

  it('colours decorators and their members', () => {
    const declaration = 'dec visible(margin string = "0px") {';

    expect(scopeOf(declaration, 'dec')).toBe('storage.type.decorator');
    expect(scopeOf(declaration, 'visible')).toBe('entity.name.function.decorator');
    expect(scopeOf('const dec = 1', 'dec')).toBe('variable.other.readwrite');
    expect(scopeOf('dec cartBadge() needs cart, auth {', 'needs')).toBe('storage.modifier.needs');
    expect(scopeOf('dec cartBadge() needs cart, auth {', 'auth')).toBe(
      'entity.name.function.decorator',
    );
    expect(scopeOf('const needs = 1', 'needs')).toBe('variable.other.readwrite');

    const shop = 'dec shop(n number) needs auth includes counter(n + 1), cart {';

    expect(scopeOf(shop, 'includes')).toBe('storage.modifier.includes');
    expect(scopeOf(shop, 'auth')).toBe('entity.name.function.decorator');
    expect(scopeOf(shop, 'counter')).toBe('entity.name.function.decorator');
    expect(scopeOf(shop, 'cart')).toBe('entity.name.function.decorator');
    expect(scopeOf(shop, '1')).toBe('constant.numeric.decimal');
    expect(scopeOf('const includes = 1', 'includes')).toBe('variable.other.readwrite');
    expect(scopeOf('    public state shown = false', 'public')).toBe('storage.modifier');
    expect(scopeOf('    public state shown = false', 'state')).toBe('storage.type.state');
    expect(scopeOf('export state items []Item = []', 'state')).toBe('storage.type.state');
    expect(scopeOf('    public func show() {', 'func')).toBe('storage.type.function');
    expect(scopeOf('@visible("300px")', 'visible')).toBe('entity.name.function.decorator');
    expect(scopeOf('    @visible.show()', 'visible')).toBe('entity.name.function.decorator');
    expect(scopeOf('    if @visible.shown {', 'visible')).toBe('entity.name.function.decorator');
  });

  it('treats mount as a keyword only at the start of a statement', () => {
    expect(scopeOf('    mount {', 'mount')).toBe('storage.type.mount');
    expect(scopeOf('    widget.mount(element)', 'mount')).not.toBe('storage.type.mount');
  });

  it('treats effect and derived as keywords only at the start of a statement', () => {
    expect(scopeOf('    effect {', 'effect')).toBe('storage.type.effect');
    expect(scopeOf('    run(effect)', 'effect')).not.toBe('storage.type.effect');
    expect(scopeOf('    derived double = count * 2', 'derived')).toBe('storage.type.state');
    expect(scopeOf('let derived = 1', 'derived')).toBe('variable.other.readwrite');
  });

  it('colours a derived block like a declaration with its type', () => {
    const source = '    derived summary string {\n        return "none"\n    }';

    expect(scopeOf(source, 'derived')).toBe('storage.type.state');
    expect(scopeOf(source, 'string')).toBe('support.type.primitive');
    expect(scopeOf(source, 'return')).toBe('keyword.control.flow');
  });

  it('colours CSS in style blocks, with values from code', () => {
    const source = `comp Card(accent string) {
    style {
        .card:hover > p { color: {accent}; margin: 0 4px }
        @media (min-width: 600px) { a { width: 50% } }
    }
    return <p />
}`;

    expect(scopeOf(source, 'style')).toBe('storage.type.style');
    expect(scopeOf(source, '.card')).toBe('entity.other.attribute-name.class.css');
    expect(scopeOf(source, ':hover')).toBe('entity.other.attribute-name.pseudo-class.css');
    expect(scopeOf(source, 'color')).toBe('support.type.property-name.css');
    expect(scopesOf(source, 'accent').at(-1)).toBe('variable.other.readwrite');
    expect(scopeOf(source, '4px')).toBe('constant.numeric.css');
    expect(scopeOf(source, '@media')).toBe('keyword.control.at-rule.css');
    // After the block the code is code again.
    expect(scopeOf(source, 'return')).toBe('keyword.control.flow');
    expect(scopeOf('let style = 1', 'style')).toBe('variable.other.readwrite');
  });

  it('colours async functions and await', () => {
    const source = 'async func load() string {\n    const text = await fetchText()\n}';

    expect(scopeOf(source, 'async')).toBe('storage.modifier.async');
    expect(scopeOf(source, 'load')).toBe('entity.name.function');
    expect(scopeOf(source, 'await')).toBe('keyword.control.flow');
    expect(scopeOf('const f = async x => x', 'async')).toBe('storage.modifier.async');
    expect(scopeOf('const n = task.await', 'await')).not.toBe('keyword.control.flow');
    expect(scopeOf('const res, err = try await load()', 'try')).toBe('keyword.control.trycatch');
  });

  it('colours data before class, and keeps it a name elsewhere', () => {
    expect(scopeOf('export data class Point {', 'data')).toBe('storage.modifier');
    expect(scopeOf('const data = load()', 'data')).not.toBe('storage.modifier');
  });

  it('colours the modifiers and accessors of classes', () => {
    expect(scopeOf('abstract class Shape {', 'abstract')).toBe('storage.modifier');
    expect(scopeOf('abstract data class Point {', 'abstract')).toBe('storage.modifier');
    expect(scopeOf('const abstract = 1', 'abstract')).not.toBe('storage.modifier');
    expect(scopeOf('    abstract area() number', 'abstract')).toBe('storage.modifier');
    expect(scopeOf('    private readonly id string', 'private readonly')).toBe('storage.modifier');
    expect(scopeOf('    get area() number {', 'get')).toBe('storage.type.property');
    expect(scopeOf('    set area(v number) {', 'set')).toBe('storage.type.property');
    expect(scopeOf('    get() number {', 'get')).not.toBe('storage.type.property');

    const constructor = '    constructor(private name string, readonly id number) { }';

    expect(scopeOf(constructor, 'private')).toBe('storage.modifier');
    expect(scopeOf(constructor, 'readonly')).toBe('storage.modifier');
    expect(scopeOf('func f(readonly number) { }', 'readonly')).not.toBe('storage.modifier');
    expect(scopeOf('comp Tabs(bind active string) {', 'bind')).toBe('storage.modifier');
    expect(scopeOf('    bind open bool = false,', 'bind')).toBe('storage.modifier');
    expect(scopeOf('func f(bind Mode) { }', 'bind')).not.toBe('storage.modifier');
  });

  it('colours regular expressions, and keeps / a division after a value', () => {
    expect(scopeOf('const r = /a+\\/b[/]/gi', '/a+\\/b[/]/gi')).toBe('string.regexp');
    expect(scopeOf('if /x/.test(s) {', '/x/')).toBe('string.regexp');
    expect(scopeOf('s.replace(/-/g, "+")', '/-/g')).toBe('string.regexp');
    expect(scopesOf('const n = a / b / c', '/')).toEqual([
      'keyword.operator.arithmetic',
      'keyword.operator.arithmetic',
    ]);
    expect(scopeOf('const n = f(x) / 2 // half', '/')).toBe('keyword.operator.arithmetic');
  });

  it('colours labels', () => {
    expect(scopeOf('outer: for row in grid {', 'outer')).toBe('entity.name.label');
    expect(scopeOf('outer:', 'outer')).toBe('entity.name.label');
    expect(scopeOf('        break outer', 'outer')).toBe('entity.name.label');
    expect(scopeOf('        continue outer', 'continue')).toBe('keyword.control.loop');
    expect(scopeOf('const o = {\n    key: 1,\n}', 'key')).toBe('meta.object-literal.key');
  });

  it('colours decode before its type, and keeps it a name elsewhere', () => {
    const source = 'const user, err = decode<User>(body)';

    expect(scopeOf(source, 'decode')).toBe('support.function');
    expect(scopeOf(source, 'User')).toBe('entity.name.type');
    expect(scopeOf('const ok = decode < 2', 'decode')).not.toBe('support.function');
    expect(scopeOf('const s = codec.decode<T>(x)', 'decode')).not.toBe('support.function');
  });

  it.each(['queue', 'topic'])('colours %s before a type, and keeps it a name elsewhere', (word) => {
    const scope = (source: string) => scopeOf(source.replaceAll('queue', word), word);

    expect(scope('func f(q queue number) queue ?string {')).toBe('storage.type');
    expect(scopesOf(`let q ${word} []number = ${word}<[]number>([])`, word)).toEqual([
      'storage.type',
      'storage.type',
    ]);
    expect(scope('let q queue (string | number)')).toBe('storage.type');
    expect(scope('let q queue <-chan number')).toBe('storage.type');
    expect(scope('const ok = queue < 2')).not.toBe('storage.type');
    expect(scope('for job in queue {')).not.toBe('storage.type');
    expect(scope('const n = queue ?? 0')).not.toBe('storage.type');
    expect(scope('const n = queue.length')).not.toBe('storage.type');
    expect(scope('const ok = queue instanceof Array')).not.toBe('storage.type');
  });

  it('colours channels', () => {
    const source = 'async func f(jobs chan number) {\n    results <- <-jobs\n}';

    expect(scopeOf(source, 'chan')).toBe('storage.type');
    expect(scopesOf(source, '<-')).toEqual([
      'keyword.operator.channel',
      'keyword.operator.channel',
    ]);
    expect(scopeOf('const c = chan<number>(10)', 'chan')).toBe('storage.type');

    // Channels of one direction: `<-` is the arrow of the channel in the type too.
    const directions = 'func f(out chan<- number, input <-chan number) {';

    expect(scopesOf(directions, 'chan')).toEqual(['storage.type', 'storage.type']);
    expect(scopesOf(directions, '<-')).toEqual([
      'keyword.operator.channel',
      'keyword.operator.channel',
    ]);
    expect(scopesOf(directions, 'number')).toEqual(Array(2).fill('support.type.primitive'));
    expect(scopeOf('select {', 'select')).toBe('keyword.control.conditional');
    expect(scopeOf('select(x)', 'select')).not.toBe('keyword.control.conditional');
  });

  it('colours go', () => {
    expect(scopeOf('const n = await go count(1, 2)', 'go')).toBe('keyword.control.flow');
    expect(scopeOf('go count(1, 2)', 'go')).toBe('keyword.control.flow');
    expect(scopeOf('go for i, v in pixels {', 'go')).toBe('keyword.control.flow');
    expect(scopeOf('go for i, v in pixels {', 'for')).toBe(scopeOf('for i, v in pixels {', 'for'));
    expect(scopeOf('const ago = 1', 'ago')).not.toBe('keyword.control.flow');
  });

  it('colours as and delete only where they are keywords', () => {
    expect(scopeOf('const n = x as number', 'as')).toBe('keyword.operator.expression.as');
    expect(scopeOf('const as = 1', 'as')).not.toBe('keyword.operator.expression.as');
    expect(scopeOf('    delete scores[name]', 'delete')).toBe('keyword.operator.expression.delete');
    expect(scopeOf('<p onClick={delete counts.a} />', 'delete')).toBe(
      'keyword.operator.expression.delete',
    );
    expect(scopeOf('const f = (delete number) => delete', 'delete')).not.toBe(
      'keyword.operator.expression.delete',
    );
  });

  it('treats ref as a keyword only at the start of a declaration', () => {
    expect(scopeOf('    ref input', 'ref')).toBe('storage.type.state');
    expect(scopeOf('    ref box HTMLElement', 'ref')).toBe('storage.type.state');
    expect(scopeOf('let ref = 1', 'ref')).toBe('variable.other.readwrite');
    expect(scopeOf('ref = 2', 'ref')).toBe('variable.other.readwrite');
  });

  it('treats state as a keyword only at the start of a declaration', () => {
    expect(scopeOf('    state count = 0', 'state')).toBe('storage.type.state');
    expect(scopeOf('let state = load()', 'state')).toBe('variable.other.readwrite');
    expect(scopeOf('state = 2', 'state')).toBe('variable.other.readwrite');
  });

  it('does not colour keywords used as property names', () => {
    expect(scopeOf('console.log(event.type)', 'type')).toBe('variable.other.property');
    expect(scopeOf('const xs = [...this.items]', 'this')).toBe('variable.language.this');
    expect(scopeOf('todos.push(todo)', 'push')).toBe('entity.name.function');
  });

  it('colours strings and template literals with expressions', () => {
    const source = 'const s = `Осталось: ${left} · ${f({ a: 1 })}`';

    expect(scopeOf(source, 'left')).toBe('variable.other.readwrite');
    expect(scopeOf(source, 'Осталось: ')).toBe('string.template');
    expect(scopeOf(source, 'f')).toBe('entity.name.function');
    expect(scopeOf('const s = "a\\nb"', '\\n')).toBe('constant.character.escape');
    expect(scopeOf('// комментарий', ' комментарий')).toBe('comment.line.double-slash');
  });

  it('colours markup: tags, components, attributes and expressions', () => {
    const source = 'return <button class="big" onClick={count++}>Нажато {count} раз</button>';

    expect(scopesOf(source, 'button')).toEqual(['entity.name.tag', 'entity.name.tag']);
    expect(scopeOf(source, 'class')).toBe('entity.other.attribute-name');
    expect(scopeOf(source, 'onClick')).toBe('entity.other.attribute-name');
    expect(scopeOf(source, 'big')).toBe('string.quoted.double');
    expect(scopesOf(source, 'count')).toEqual([
      'variable.other.readwrite',
      'variable.other.readwrite',
    ]);
    expect(scopeOf(source, 'Нажато ')).toBe('meta.jsx.children');

    const item = '<TodoItem todo={todo} onToggle={todos.toggle(todo.id)} />';

    expect(scopeOf(item, 'TodoItem')).toBe('support.class.component');
    // A component taken from a value, and its type.
    expect(scopesOf('<section.content></section.content>', 'section.content')).toEqual([
      'support.class.component',
      'support.class.component',
    ]);
    expect(scopeOf('content comp(title string)', 'comp')).toBe('storage.type.component');
    expect(scopeOf('content comp(title string)', 'string')).toBe('support.type.primitive');
    expect(scopeOf('<input bind:value={title} />', 'bind')).toBe(
      'entity.other.attribute-name.namespace',
    );
    expect(scopeOf('<p>a &amp; b</p>', '&amp;')).toBe('constant.character.entity');
  });

  it('tells comparisons from markup', () => {
    expect(scopeOf('if a < b {', '<')).toBe('keyword.operator.comparison');
    expect(scopeOf('for let i = 0; i<n; i++ {', '<')).toBe('keyword.operator.comparison');
    expect(scopeOf('if count <= limit {', '<=')).toBe('keyword.operator.comparison');
    expect(scopeOf('const ok = f() <g', '<')).toBe('keyword.operator.comparison');
    expect(scopeOf('if count <limit {', '<')).toBe('keyword.operator.comparison');
    expect(scopeOf('return <div />', 'div')).toBe('entity.name.tag');
    expect(scopeOf('case 1:\n    throw <b />', 'b')).toBe('entity.name.tag');
  });

  it('colours control flow and elements nested in markup', () => {
    const source = `const list = <div>{for i, product in products with key product.id {
    if product != null {
        <Product {...product} />
    } else {
        <>Пусто</>
    }
}}</div>`;

    expect(scopeOf(source, 'for')).toBe('keyword.control.loop');
    expect(scopeOf(source, 'with')).toBe('keyword.control.loop');
    expect(scopeOf(source, 'key')).toBe('keyword.control.loop');
    expect(scopeOf('const key = with', 'key')).not.toBe('keyword.control.loop');
    expect(scopeOf(source, 'if')).toBe('keyword.control.conditional');
    expect(scopeOf(source, 'Product')).toBe('support.class.component');
    expect(scopeOf(source, '...')).toBe('keyword.operator.spread');
    expect(scopeOf(source, 'Пусто')).toBe('meta.jsx.children');
    expect(scopesOf(source, 'div')).toEqual(['entity.name.tag', 'entity.name.tag']);
    expect(tokenize(source).stack.depth).toBe(textmate.INITIAL.depth);
  });

  it('closes every construct in the Rook files of the repository', () => {
    const files = [
      ...readdirSync(join(root, 'examples')).map((name) => join(root, 'examples', name)),
      ...readdirSync(join(root, 'site/src')).map((name) => join(root, 'site/src', name)),
      join(root, 'site/server.rk'),
    ].filter((path) => path.endsWith('.rk'));

    expect(files.length).toBeGreaterThan(3);
    for (const path of files) {
      const { stack } = tokenize(readFileSync(path, 'utf8'));

      expect([path, stack.depth]).toEqual([path, textmate.INITIAL.depth]);
    }
  });
});
