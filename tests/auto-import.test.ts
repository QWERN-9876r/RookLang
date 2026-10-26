import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { complete, importFixes, type CompletionList, type TextEdit } from '../src/index.ts';
import { markupProject } from './project.ts';

// Imports that the editor adds: completion of the names that other modules of the package export,
// and quick fixes for names that are not defined. `‸` marks the cursor.

const LIB = `export func formatDate(date Date) string { return date.toISOString() }
export const LIMIT = 10
export interface User { name string }
export class Account {}
export comp Avatar(user User) { return <img alt={user.name} /> }
export dec tracked() {}
func hidden() {}
`;

/** A project with `lib.rk`, `ui/button.rk` and the files given, by their paths. */
function project(files: Record<string, string> = {}): string {
  const dir = markupProject('rook-auto-import-');

  mkdirSync(join(dir, 'ui'));
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(dir, 'lib.rk'), LIB);
  writeFileSync(join(dir, 'ui', 'button.rk'), 'export comp Button() { return <button /> }\n');
  writeFileSync(join(dir, 'node_modules', 'pkg', 'dep.rk'), 'export func fromPackage() {}\n');
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);

  return dir;
}

function completeAt(dir: string, text: string, file = 'app.rk'): CompletionList {
  return complete(text.replace('‸', ''), text.indexOf('‸'), { filename: join(dir, file) });
}

/** The names offered with an import, as `name specifier`. */
function imported(dir: string, text: string, file?: string): string[] {
  return completeAt(dir, text, file).items.flatMap((item) =>
    item.import ? [`${item.name} ${item.import.specifier}`] : [],
  );
}

function apply(source: string, { start, end, text }: TextEdit): string {
  return source.slice(0, start) + text + source.slice(end);
}

/** The module after choosing the item `name`, with its import. */
function choose(dir: string, text: string, name: string): string {
  const item = completeAt(dir, text).items.find((each) => each.name === name);

  if (!item?.import) throw new Error(`no import of ${name}`);

  return apply(text.replace('‸', ''), item.import.edit);
}

describe('completion with imports', () => {
  const dir = project();

  it('offers the exported names that fit where the cursor is', () => {
    expect(imported(dir, 'func main() {\n    form‸\n}\n')).toEqual([
      'formatDate ./lib.rk',
      'LIMIT ./lib.rk',
      'Account ./lib.rk',
      'Avatar ./lib.rk',
      'Button ./ui/button.rk',
    ]);
    expect(imported(dir, 'let user U‸\n')).toEqual(['User ./lib.rk', 'Account ./lib.rk']);
    expect(imported(dir, 'comp App() {\n    return <Av‸ />\n}\n')).toEqual([
      'Avatar ./lib.rk',
      'Button ./ui/button.rk',
    ]);
    // Members, attributes and names being declared are not names of modules.
    expect(imported(dir, 'let user = {name: "a"}\nconsole.log(user.n‸)\n')).toEqual([]);
    expect(imported(dir, 'let for‸\n')).toEqual([]);
  });

  it('gives the kind of each name', () => {
    const items = completeAt(dir, 'func main() {\n    ‸\n}\n').items.filter((item) => item.import);

    expect(items.map((item) => `${item.name} ${item.kind}`)).toEqual([
      'formatDate function',
      'LIMIT constant',
      'Account class',
      'Avatar component',
      'Button component',
    ]);
  });

  it('does not offer names in scope, nor those of packages or of the module itself', () => {
    const text =
      'import { formatDate } from "./lib.rk"\n\nexport func local() {}\nfunc main() {\n    ‸\n}\n';

    expect(imported(dir, text)).toEqual([
      'LIMIT ./lib.rk',
      'Account ./lib.rk',
      'Avatar ./lib.rk',
      'Button ./ui/button.rk',
    ]);
  });

  it('writes the path from the directory of the module', () => {
    expect(imported(dir, 'func main() {\n    form‸\n}\n', 'ui/form.rk')).toContain(
      'formatDate ../lib.rk',
    );
  });

  it('puts a new import at the start of a module without imports', () => {
    expect(choose(dir, 'func main() {\n    form‸\n}\n', 'formatDate')).toBe(
      'import { formatDate } from "./lib.rk"\n\nfunc main() {\n    form\n}\n',
    );
  });

  it('puts a new import after the last one', () => {
    const text = 'import { readFileSync } from "node:fs"\n\nfunc main() {\n    ‸\n}\n';

    expect(choose(dir, text, 'Button')).toBe(
      'import { readFileSync } from "node:fs"\nimport { Button } from "./ui/button.rk"\n\nfunc main() {\n    \n}\n',
    );
  });

  it('adds the name to an import of the same module', () => {
    const text = 'import { LIMIT } from "./lib.rk"\n\nlet a Us‸\n';

    expect(choose(dir, text, 'User')).toBe('import { LIMIT, User } from "./lib.rk"\n\nlet a Us\n');
  });

  it('sees changes of the modules on disk', () => {
    const changing = project({ 'extra.rk': 'export func first() {}\n' });

    expect(imported(changing, 'func main() {\n    ‸\n}\n')).toContain('first ./extra.rk');
    writeFileSync(join(changing, 'extra.rk'), 'export func second() {}\n// changed\n');
    expect(imported(changing, 'func main() {\n    ‸\n}\n')).toContain('second ./extra.rk');
  });
});

describe('quick fixes', () => {
  const dir = project({ 'other.rk': 'export func formatDate() {}\n' });
  const file = join(dir, 'app.rk');

  it('import a value, a type, a component or a decorator that is not defined', () => {
    const titles = (message: string) => importFixes('', file, message).map((fix) => fix.title);

    expect(titles('"formatDate" is not defined')).toEqual([
      'Add import { formatDate } from "./lib.rk"',
      'Add import { formatDate } from "./other.rk"',
    ]);
    expect(titles('unknown type "User"')).toEqual(['Add import { User } from "./lib.rk"']);
    expect(titles('unknown component <Button>')).toEqual([
      'Add import { Button } from "./ui/button.rk"',
    ]);
    expect(titles('unknown decorator @tracked')).toEqual([
      'Add import { tracked } from "./lib.rk"',
    ]);
  });

  it('only for names that are exported in the namespace of the error', () => {
    expect(importFixes('', file, '"hidden" is not defined')).toEqual([]);
    expect(importFixes('', file, '"User" is not defined')).toEqual([]);
    expect(importFixes('', file, 'cannot use number as string')).toEqual([]);
  });

  it('edit the imports of the module', () => {
    const source = 'import { LIMIT } from "./lib.rk"\nimport "./setup.rk"\n\nlet a Account\n';
    const [fix] = importFixes(source, file, 'unknown type "Account"');

    expect(apply(source, fix!.edit)).toBe(
      'import { LIMIT, Account } from "./lib.rk"\nimport "./setup.rk"\n\nlet a Account\n',
    );
  });
});
