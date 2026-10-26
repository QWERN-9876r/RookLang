import { dirname, relative, resolve, sep } from 'node:path';
import type * as ast from './ast.ts';
import type { Completion, TextEdit } from './checker/checker.ts';
import type { CompletionList } from './completion.ts';
import { markupFor } from './config.ts';
import { parse } from './parser/parser.ts';
import { projectExports, type ExportSpace } from './project-modules.ts';

// Imports that the editor writes: completion offers the names that other `.rk` modules of the
// package export, and choosing one adds it to the imports of the module; a name that is not
// defined gets a quick fix that imports it. The import goes into an `import { ... }` of the same
// module if there is one, else on a line of its own after the last import.

/** A fix of a diagnostic: the import of the name from one module. */
export interface ImportFix {
  title: string;
  edit: TextEdit;
}

const SPACES: Partial<Record<NonNullable<CompletionList['context']>, ExportSpace>> = {
  value: 'value',
  type: 'type',
  tag: 'tag',
};

/** The names of other modules that fit where the cursor is and that are not in scope there. */
export function importCompletions(
  source: string,
  filename: string,
  list: CompletionList,
): Completion[] {
  const space = list.context && SPACES[list.context];

  if (!space) return [];

  const known = new Set(list.items.map((item) => item.name));
  const candidates = projectExports(filename).filter(
    (each) => each.spaces.includes(space) && !known.has(each.name),
  );

  if (candidates.length === 0) return [];

  const imports = importsOf(source, filename);

  return candidates.map((each) => {
    const specifier = specifierOf(filename, each.path);

    return {
      name: each.name,
      kind: each.kind,
      import: { specifier, edit: importEdit(source, imports, each.name, specifier, each.path) },
    };
  });
}

const UNDEFINED: [RegExp, ExportSpace][] = [
  [/^"(.+)" is not defined$/, 'value'],
  [/^unknown type "(.+)"$/, 'type'],
  [/^unknown component <(.+)>$/, 'tag'],
  [/^unknown decorator @(.+)$/, 'decorator'],
];

/** For an error about a name that is not defined, the imports of the modules that export it. */
export function importFixes(source: string, filename: string, message: string): ImportFix[] {
  for (const [pattern, space] of UNDEFINED) {
    const name = pattern.exec(message)?.[1];

    if (name === undefined) continue;

    const imports = importsOf(source, filename);

    return projectExports(filename)
      .filter((each) => each.name === name && each.spaces.includes(space))
      .map((each) => {
        const specifier = specifierOf(filename, each.path);

        return {
          title: `Add import { ${name} } from "${specifier}"`,
          edit: importEdit(source, imports, name, specifier, each.path),
        };
      });
  }

  return [];
}

/** The imports of the module, with the absolute paths of the modules they import. */
function importsOf(source: string, filename: string): [ast.ImportDeclaration, string][] {
  const { program } = parse(source, { markup: markupFor(filename) });

  return program.body.flatMap((statement) =>
    statement.kind === 'ImportDeclaration'
      ? [[statement, resolve(dirname(filename), statement.source.value)]]
      : [],
  );
}

/** The path of a module as an import of the file `filename` writes it: "./card.rk". */
function specifierOf(filename: string, path: string): string {
  const specifier = relative(dirname(resolve(filename)), path)
    .split(sep)
    .join('/');

  return specifier.startsWith('../') ? specifier : `./${specifier}`;
}

function importEdit(
  source: string,
  imports: readonly [ast.ImportDeclaration, string][],
  name: string,
  specifier: string,
  path: string,
): TextEdit {
  const same = imports.find(([node, from]) => from === path && node.namedImports.length > 0);
  const last = same?.[0].namedImports.at(-1);

  if (last) return { start: last.end, end: last.end, text: `, ${name}` };

  const line = `import { ${name} } from "${specifier}"`;
  const after = imports.at(-1)?.[0];

  if (!after) return { start: 0, end: 0, text: `${line}\n\n` };

  const end = source.indexOf('\n', after.end);

  return end === -1
    ? { start: source.length, end: source.length, text: `\n${line}` }
    : { start: end + 1, end: end + 1, text: `${line}\n` };
}
