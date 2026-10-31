import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';
import { markupProject } from './project.ts';

// Imports by aliases: subpath imports of package.json, `#ui/button.rk`, and the paths of
// tsconfig.json, `@/lib/format.rk`, are typed as relative ones are, and built as `.js` next to them.

function project(): string {
  const dir = markupProject('rook-aliases-');

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      rook: { markup: true },
      imports: { '#ui/*': './src/ui/*', '#lib/*': './src/lib/*' },
    }),
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    '{\n  // Comments, as tsconfig.json has them.\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },\n}\n',
  );
  mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
  mkdirSync(join(dir, 'src', 'lib'));
  writeFileSync(
    join(dir, 'src', 'ui', 'button.rk'),
    'export comp Button(label string) {\n    return <button>{label}</button>\n}\n',
  );
  writeFileSync(
    join(dir, 'src', 'lib', 'format.rk'),
    'export func format(n number) string {\n    return `${n}`\n}\n',
  );
  writeFileSync(
    join(dir, 'src', 'lib', 'util.ts'),
    'export function twice(n: number): number { return n * 2 }\n',
  );

  return dir;
}

describe('aliases', () => {
  const dir = project();
  const main = (source: string) => compile(source, { filename: join(dir, 'src', 'main.rk') });

  it('type the modules they name', () => {
    const { diagnostics } = main(`import { Button } from "#ui/button.rk"
import { format } from "@/lib/format.rk"
import { twice } from "@/lib/util.ts"
const a number = format(1)
const b string = twice(2)
const c = <Button label={1} />`);

    expect(diagnostics.map((d) => d.message)).toEqual([
      'cannot use string as number',
      'cannot use number as string',
      'cannot use number as string for "label" of <Button>',
    ]);
  });

  it('are built as .js, and other packages stay as they are', () => {
    const { code } = main(`import { format } from "#lib/format.rk"
import { twice } from "@/lib/util.ts"
import { parse } from "pkg/file.rk"
console.log(format(twice(1)), parse)`);

    expect(code).toContain('import { format } from "#lib/format.js";');
    expect(code).toContain('import { twice } from "@/lib/util.ts";');
    expect(code).toContain('import { parse } from "pkg/file.rk";');
  });
});
