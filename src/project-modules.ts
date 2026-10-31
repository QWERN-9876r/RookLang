import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type * as ast from './ast.ts';
import type { Completion } from './checker/checker.ts';
import { markupFor } from './config.ts';
import { parse } from './parser/parser.ts';

// The `.rk` modules of the package that a file is in, with the names they export, for imports that
// the editor adds (auto-import.ts). Only the parser reads them: what a module exports and what kind
// of name each is shows in the declarations, and checking every module of a project would take
// long. The language server runs long, so each module is parsed again only when it changes.

/** What a name is used as, and so where it is offered: decorators have a namespace of their own. */
export type ExportSpace = 'value' | 'type' | 'tag' | 'decorator';

export interface ExportedName {
  name: string;
  kind: Completion['kind'];
  spaces: ExportSpace[];
  /** The absolute path of the module. */
  path: string;
}

/** Directories that hold no sources of the package. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
/** A bound on the files read, for a file opened in a directory as big as the home directory. */
const MAX_FILES = 5000;

const parsed = new Map<string, { version: string; names: ExportedName[] }>();
/** The modules being read, for `export ... from` that go round in a cycle. */
const reading = new Set<string>();

/** The names exported by the other `.rk` modules of the package of `filename`. */
export function projectExports(filename: string): ExportedName[] {
  const self = resolve(filename);

  return rookFiles(packageRoot(self))
    .filter((path) => path !== self)
    .flatMap(exportsOf);
}

/** The directory of the nearest package.json above the file, or that of the file without one. */
function packageRoot(filename: string): string {
  for (let dir = dirname(filename); ; dir = dirname(dir)) {
    if (exists(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) return dirname(filename);
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);

    return true;
  } catch {
    return false;
  }
}

function rookFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.')) continue;

      const path = join(dir, entry.name);

      if (entry.isDirectory() && !SKIPPED.has(entry.name)) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.rk')) files.push(path);
    }
  };

  visit(root);

  return files;
}

function exportsOf(path: string): ExportedName[] {
  let version: string;

  try {
    const stats = statSync(path);

    version = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return [];
  }

  const cached = parsed.get(path);

  if (cached?.version === version) return cached.names;
  if (reading.has(path)) return [];

  let names: ExportedName[];

  reading.add(path);
  try {
    const { program } = parse(readFileSync(path, 'utf8'), { markup: markupFor(path) });

    names = program.body.flatMap((statement) => exported(statement, path));
  } catch {
    names = [];
  } finally {
    reading.delete(path);
  }

  parsed.set(path, { version, names });

  return names;
}

function exported(statement: ast.Statement, path: string): ExportedName[] {
  const name = (
    node: ast.Identifier,
    kind: Completion['kind'],
    spaces: ExportSpace[],
  ): ExportedName => ({ name: node.name, kind, spaces, path });

  if (statement.kind === 'ExportFromDeclaration') return reexported(statement, path);
  if (!('exported' in statement) || !statement.exported) return [];

  switch (statement.kind) {
    case 'FuncDeclaration':
      return [name(statement.name, 'function', ['value'])];

    case 'ClassDeclaration':
      return [name(statement.name, 'class', ['value', 'type'])];

    case 'ComponentDeclaration':
      return [name(statement.name, 'component', ['value', 'tag'])];

    case 'DecoratorDeclaration':
      return [name(statement.name, 'function', ['decorator'])];

    case 'InterfaceDeclaration':
    case 'TypeAliasDeclaration':
      return [name(statement.name, 'type', ['type'])];

    case 'VariableDeclaration': {
      const kind = statement.keyword === 'const' ? 'constant' : 'variable';

      return statement.names.map((each) => name(each, kind, ['value']));
    }

    default:
      return [];
  }
}

/** `export { Rows } from "./rows.rk"`: the names of that module, as this one exports them. */
function reexported(statement: ast.ExportFromDeclaration, path: string): ExportedName[] {
  if (!statement.source.value.endsWith('.rk')) return [];

  const names = exportsOf(resolve(dirname(path), statement.source.value));

  if (!statement.specifiers) return names.map((each) => ({ ...each, path }));

  return statement.specifiers.flatMap(({ imported, local }) =>
    names
      .filter((each) => each.name === imported.name)
      .map((each) => ({ ...each, name: local.name, path })),
  );
}
