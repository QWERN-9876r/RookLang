import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Where a `.rk` module that an import names is: a relative path, a subpath import of package.json,
// `#ui/button.rk` with "imports": { "#ui/*": "./src/ui/*" }, or a path of tsconfig.json,
// `@/ui/button.rk` with "paths": { "@/*": ["./src/*"] }, which Vite and TypeScript resolve too.

/** The absolute path of the `.rk` module `specifier` imported from `fromFile`, or null. */
export function resolveRookModule(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolve(dirname(fromFile), specifier);
  }

  if (specifier.startsWith('#')) {
    const found = nearest(fromFile, 'package.json');
    const imports = found?.json.imports as Record<string, unknown> | undefined;
    const target = imports && match(imports, specifier);

    return found && typeof target === 'string' ? resolve(found.dir, target) : null;
  }

  const found = nearest(fromFile, 'tsconfig.json');
  const options = found?.json.compilerOptions as
    { baseUrl?: string; paths?: Record<string, unknown> } | undefined;
  const target = options?.paths && match(options.paths, specifier);

  return found && typeof target === 'string'
    ? resolve(found.dir, options?.baseUrl ?? '.', target)
    : null;
}

/** The target of the first pattern that fits, with its `*` filled in. */
function match(patterns: Record<string, unknown>, specifier: string): string | null {
  for (const [pattern, value] of Object.entries(patterns)) {
    const target = firstTarget(value);
    const star = pattern.indexOf('*');

    if (target === null) continue;
    if (star === -1) {
      if (pattern === specifier) return target;
      continue;
    }

    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);

    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      return target.replace('*', specifier.slice(prefix.length, specifier.length - suffix.length));
    }
  }

  return null;
}

/** A path, the first of a list, or that of the conditions `import` or `default`. */
function firstTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstTarget(value[0]);
  if (value && typeof value === 'object') {
    const conditions = value as Record<string, unknown>;

    return firstTarget(conditions.import ?? conditions.default ?? null);
  }

  return null;
}

/** The nearest file of this name above `fromFile`, read as JSON with comments, as tsconfig.json is. */
function nearest(
  fromFile: string,
  name: string,
): { dir: string; json: Record<string, unknown> } | null {
  for (let dir = dirname(fromFile); ; dir = dirname(dir)) {
    let text: string | null = null;

    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      // Not in this directory.
    }

    if (text !== null) {
      try {
        return { dir, json: JSON.parse(withoutComments(text)) as Record<string, unknown> };
      } catch {
        return null;
      }
    }

    if (dirname(dir) === dir) return null;
  }
}

/** JSON without the comments and trailing commas that tsconfig.json may have. */
function withoutComments(text: string): string {
  return text
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (part) =>
      part.startsWith('"') ? part : '',
    )
    .replace(/,(\s*[}\]])/g, '$1');
}
