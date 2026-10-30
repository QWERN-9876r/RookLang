import { readFileSync } from 'node:fs';
import type { CompileResult } from './compile.ts';
import { formatDiagnostic } from './diagnostics.ts';
import { compile } from './index.ts';
import { SourceFile } from './source.ts';

// Compiling a file for the CLI: errors become one exception with the messages for the terminal.

/** Compile errors, already formatted for the terminal. */
export class CompileError extends Error {}

/** Compiles a file; prints its warnings unless `quiet`, throws a CompileError on errors. */
export function compileFile(
  path: string,
  options: {
    rewriteImports: boolean;
    typeCheck: boolean;
    markup?: boolean | undefined;
    quiet?: boolean;
    /** Where the worker module of `go` is, and what its worker imports first (bun.ts). */
    workerUrl?: string;
    nodeLoader?: string;
  },
): CompileResult {
  const source = readFileSync(path, 'utf8');
  const { quiet, ...compileOptions } = options;
  const result = compile(source, { filename: path, ...compileOptions });
  const file = new SourceFile(path, source);

  if (!quiet) {
    for (const warning of result.warnings) {
      console.warn(`${formatDiagnostic(file, warning, 'warning')}\n`);
    }
  }

  if (result.diagnostics.length > 0) {
    throw new CompileError(result.diagnostics.map((d) => formatDiagnostic(file, d)).join('\n\n'));
  }

  return result;
}
