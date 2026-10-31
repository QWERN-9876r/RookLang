import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';
import { rook } from '../src/vite.ts';
import { mountJsWithDom } from './fake-dom.ts';
import { markupProject } from './project.ts';

// `export { Rows } from "./rows.rk"` and `export * from "./rows.rk"`: a module passes on names of
// another, with what its components, decorators and state need in the modules that use them.

const rows = `const PREFIX = "#"

export interface Row {
    id number
    name string
}

export state count = 0

export func add() {
    count++
}

comp Cell(text string) {
    return <i>{PREFIX}{text}</i>
}

export comp Rows(items []Row) {
    return <ul>{for item in items { <li><Cell text={item.name} />{count}</li> }}</ul>
}

export dec ticker() {
    public state ticks = PREFIX.length
}
`;

const app = `import { Rows, Row, add, total, ticker } from "./index.rk"

const items []Row = [{ id: 1, name: "a" }]

@ticker
comp Clock() {
    return <p>{@ticker.ticks}:{total}</p>
}

document.body.append(<Rows items={items} />, <Clock />)
add()
`;

function project(files: Record<string, string>): string {
  const dir = markupProject('rook-reexport-');

  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);

  return dir;
}

function compileIn(dir: string, name: string, declarations = false) {
  const filename = join(dir, name);

  return compile(readFileSync(filename, 'utf8'), { filename, declarations });
}

const index = 'export { Rows, Row, add, count as total, ticker } from "./rows.rk"\n';

describe('syntax', () => {
  it('reads the names, renamed ones and *', () => {
    const [named, all] = parse(`${index}export * from "./cells.rk"`).program.body;

    expect(named).toMatchObject({
      kind: 'ExportFromDeclaration',
      specifiers: [
        { local: { name: 'Rows' } },
        {},
        {},
        { imported: { name: 'count' }, local: { name: 'total' } },
        {},
      ],
      source: { value: './rows.rk' },
    });
    expect(all).toMatchObject({ kind: 'ExportFromDeclaration', specifiers: null });
    expect(parse('export { a }').diagnostics.map((d) => d.message)).toEqual([
      'a module exports its own names where they are declared, e.g. export func f(); export { ... } needs from "./module.rk"',
    ]);
  });
});

describe('types', () => {
  const errors = (barrel: string, main = app) =>
    compileIn(
      project({ 'rows.rk': rows, 'index.rk': barrel, 'main.rk': main }),
      'main.rk',
    ).diagnostics.map((d) => d.message);

  it('gives the modules that import the names their types', () => {
    expect(errors(index)).toEqual([]);
    expect(
      errors(
        'export * from "./rows.rk"',
        app.replace('total', 'count').replace('{total}', '{count}'),
      ),
    ).toEqual([]);
    expect(
      errors(index, 'import { Rows } from "./index.rk"\nconst r = <Rows items={1} />'),
    ).toEqual(['cannot use number as []Row for "items" of <Rows>']);
  });

  it('reports names the module does not export, and renamed components', () => {
    const barrel = (names: string) =>
      compileIn(
        project({ 'rows.rk': rows, 'index.rk': `export { ${names} } from "./rows.rk"` }),
        'index.rk',
      ).diagnostics.map((d) => d.message);

    expect(barrel('Cell')).toEqual(['"Cell" is not exported by "./rows.rk"']);
    expect(barrel('Rows as Table')).toEqual([
      'renaming components is not supported yet: export { Rows }',
    ]);
  });

  it('reports a component exported in a constant, and says how to pass it on', () => {
    const barrel = 'import { Rows as Inner } from "./rows.rk"\n\nexport const Rows = Inner\n';

    expect(
      compileIn(project({ 'rows.rk': rows, 'index.rk': barrel }), 'index.rk').diagnostics.map(
        (d) => d.message,
      ),
    ).toEqual([
      'a component is exported by its name, not in a constant without a type: write export { Rows } from "./rows.rk", or give the constant a type, e.g. export const Rows comp(title string) = Inner',
    ]);
  });

  it('does not bring the names into the module itself, as in JS', () => {
    expect(
      compileIn(
        project({ 'rows.rk': rows, 'index.rk': `${index}add()` }),
        'index.rk',
      ).diagnostics.map((d) => d.message),
    ).toEqual(['"add" is not defined']);
  });
});

describe('generated code', () => {
  it('passes on the hidden names, and only values and types in the .d.ts', () => {
    const dir = project({ 'rows.rk': rows, 'index.rk': `${index}export * from "./rows.rk"\n` });
    const { code, declarations } = compileIn(dir, 'index.rk', true);

    expect(code).toContain(
      'export { $$Rows, add, count as total, $$listeners$count as $$listeners$total, $$ticker$PREFIX } from "./rows.js";',
    );
    expect(code).toContain('export * from "./rows.js";');
    expect(declarations).toContain('export { Row, add, count as total } from "./rows.js";');
  });
});

describe('running', () => {
  it('works when Vite bundles the modules', async () => {
    const dir = project({
      'index.html': '<script type="module" src="./main.rk"></script>',
      'rows.rk': rows,
      'index.rk': index,
      'main.rk': app,
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

    expect(String(body)).toBe('<body><ul><li><i>#a</i>1</li></ul><p>1:1</p></body>');
  });
});
