import type * as ast from '../ast.ts';
import { declarationsOf } from './analysis.ts';
import type { JsOptions } from './options.ts';
import { FunctionEmitter } from './functions.ts';
import { moduleGo, runtimeCode, runtimeNames } from './runtime.ts';

export type { JsOptions } from './options.ts';

/** A component whose inlined copies add more lines than this to its module becomes a function. */
export const INLINE_LIMIT = 100;

/**
 * Generates a readable ES module from a program that has parsed without errors. A component is
 * inlined where it is used, unless that adds more than INLINE_LIMIT lines compared to a function
 * and its calls. The module is generated again with each such candidate as a function, and the one
 * that saves the most goes first: that changes the sizes of the components inside it. A component
 * of another module is a candidate too; its function is in that module, and counts as one copy.
 */
export function generateJs(program: ast.Program, options: JsOptions): string {
  const functions = new Set<string>();
  const generate = (names: ReadonlySet<string>) => {
    const generator = new JsGenerator(program, { ...options, functions: names });
    const code = generator.generate();
    const lines = code.split('\n').filter((line) => line.trim() !== '').length;

    return { code, lines, generator };
  };
  let current = generate(functions);

  while (true) {
    let best: (ReturnType<typeof generate> & { name: string; saved: number }) | null = null;
    const { inlined, alwaysInlined } = current.generator;

    for (const [name, { copies, lines }] of inlined) {
      // A function and its calls are larger than one copy, and save no more than the copies take.
      if (copies < 2 || lines <= INLINE_LIMIT || alwaysInlined.has(name)) continue;

      const trial = generate(new Set([...functions, name]));
      const own = options.components?.has(name) ? Math.ceil(lines / copies) : 0;
      const saved = current.lines - trial.lines - own;

      if (saved > INLINE_LIMIT && (!best || saved > best.saved)) best = { ...trial, name, saved };
    }

    if (!best) return current.code;

    functions.add(best.name);
    current = best;
  }
}

/** The whole module: its statements, plus the runtime that its code needs. */
class JsGenerator extends FunctionEmitter {
  generate(): string {
    this.withScope(declarationsOf(this.program.body), () => {
      this.statements(this.program.body);
      this.webComponentClasses();
      this.hiddenExports();
    });

    const { goroutines } = this.options;
    const inWorker = goroutines !== undefined && 'targets' in goroutines;

    // The worker module runs the functions that `go` calls (see goroutines.ts).
    if (inWorker) {
      const names = goroutines.targets.map((name) => this.name(name));

      this.lines.push(
        '',
        `const $$goroutines = { ${names.join(', ')} };`,
        '$$serve($$goroutines);',
      );
    }

    let imports = 0;

    while (this.lines[imports]?.startsWith('import ')) imports++;

    const rest = this.lines.slice(imports);
    // The CSS of the components goes before the code, so that the page has it before the markup.
    const styles = this.styleRegistrations();
    // What is the module's own: its `go`, and the CSS of its components for their shadow roots.
    const own = [
      ...(/(?<![.\w$])\$\$go(?![\w$])/.test(rest.join('\n'))
        ? moduleGo(inWorker ? null : (goroutines?.workerUrl ?? ''))
        : []),
      ...(styles.length > 0 ? ['const $$styles = [];'] : []),
    ];
    // The types that decode checks against, before the code that may decode at the top level.
    const types = this.decodeTypeLines();
    const mode = this.options.runtime ?? 'import';
    const runtime = runtimeCode(
      runtimeNames([...own, ...types, ...styles, ...rest].join('\n')),
      mode,
    );

    if (runtime.length === 0 && own.length === 0 && styles.length === 0) {
      return this.lines.length === 0 ? '' : `${this.lines.join('\n')}\n`;
    }

    while (rest[0] === '') rest.shift();

    // The import of the runtime goes with the other imports; the runtime itself, after them.
    const head = this.lines.slice(0, imports);
    const sections = [
      mode === 'import' ? [...head, ...runtime] : head,
      mode === 'inline' ? runtime : [],
      own,
      types,
      styles,
      rest,
    ].filter((section) => section.length > 0);

    return `${sections.flatMap((section, i) => [...(i > 0 ? [''] : []), ...section]).join('\n')}\n`;
  }
}
