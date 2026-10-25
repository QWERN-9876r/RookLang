#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { build, displayPath, type BuildOptions } from './build.ts';
import { CompileError, compileFile } from './compile-file.ts';
import { markupFor } from './config.ts';
import { formatDiagnostic, type Diagnostic } from './diagnostics.ts';
import { tokenize } from './lexer/lexer.ts';
import { parse } from './parser/parser.ts';
import { runFile } from './run-file.ts';
import { SourceFile } from './source.ts';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

const HELP = `Rook ${version}

Usage:
  rook build <file.rk | dir>...   Compile to .js files, with the .rk files they import
  rook run <file.rk>              Compile and run, with the .rk files it imports
  rook tokens <file.rk>           Print lexer tokens (for debugging)
  rook ast <file.rk>              Print the syntax tree (for debugging)

Options:
      --out-dir <dir>   build: write the .js files to <dir>, keeping the folder structure
                        (by default they go next to the .rk files)
      --stdout          build: print the JS of a single file instead of writing files
      --no-source-map   build: do not write the source maps, app.js.map
      --watch           run: run again when a file of the program changes
      --no-check        Skip type checking
      --markup          Turn markup and components on; by default they are on where the
                        package.json has "rook": { "markup": true }
      --no-markup       Turn them off
  -h, --help            Show this help
  -v, --version         Show version`;

/** A mistake in how the CLI was called. */
class UsageError extends Error {}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'out-dir': { type: 'string' },
      stdout: { type: 'boolean' },
      'no-check': { type: 'boolean' },
      'no-source-map': { type: 'boolean' },
      watch: { type: 'boolean' },
      markup: { type: 'boolean' },
      'no-markup': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    console.log(version);

    return;
  }

  const [command, ...files] = positionals;

  if (values.help || !command) {
    console.log(HELP);

    return;
  }

  if (files.length === 0) throw new UsageError(`missing input file for "${command}"`);
  for (const path of files) {
    if (!existsSync(path)) throw new UsageError(`file not found: ${path}`);
  }

  if (command !== 'build' && files.length > 1) {
    throw new UsageError(`"${command}" takes a single file`);
  }

  const file = files[0]!;
  const typeCheck = !values['no-check'];

  if (values.markup && values['no-markup']) {
    throw new UsageError('--markup and --no-markup cannot be used together');
  }

  // Unless one of them is given, each file takes the setting of its package.json (config.ts).
  const markup = values.markup ? true : values['no-markup'] ? false : undefined;

  switch (command) {
    case 'build':
      if (values.stdout) {
        if (files.length > 1 || statSync(file).isDirectory()) {
          throw new UsageError('--stdout needs a single .rk file');
        }

        process.stdout.write(compileFile(file, { rewriteImports: true, typeCheck, markup }).code);
      } else {
        buildFiles(files, {
          outDir: values['out-dir'],
          typeCheck,
          markup,
          sourceMap: !values['no-source-map'],
        });
      }

      break;

    case 'run':
      runFile(file, { typeCheck, markup, watch: values.watch === true });
      break;

    case 'tokens':
      printTokens(new SourceFile(file, readFileSync(file, 'utf8')));
      break;

    case 'ast':
      printAst(new SourceFile(file, readFileSync(file, 'utf8')), markup ?? markupFor(file));
      break;

    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

/** Builds the files and directories and writes the `.js` files, or none if there are errors. */
function buildFiles(entries: string[], options: BuildOptions): void {
  for (const entry of entries) {
    if (!statSync(entry).isDirectory() && !entry.endsWith('.rk')) {
      throw new UsageError(`not a .rk file: ${entry}`);
    }
  }

  const { outputs, errors, warnings } = build(entries, options);

  for (const { file, diagnostics } of warnings) {
    for (const warning of diagnostics)
      console.warn(`${formatDiagnostic(file, warning, 'warning')}\n`);
  }

  if (errors.length > 0) {
    const messages = errors.flatMap(({ file, diagnostics }) =>
      diagnostics.map((diagnostic) => formatDiagnostic(file, diagnostic)),
    );

    throw new CompileError(messages.join('\n\n'));
  }

  for (const { source, output, code, declarations, worker, maps = [] } of outputs) {
    const extra = `${declarations ? ' + .d.ts' : ''}${worker ? ' + .worker.js' : ''}${maps.length > 0 ? ' + .js.map' : ''}`;

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, code);
    if (declarations) writeFileSync(declarations.output, declarations.code);
    if (worker) writeFileSync(worker.output, worker.code);
    for (const map of maps) writeFileSync(map.output, map.code);
    console.log(`${displayPath(source)} → ${displayPath(output)}${extra}`);
  }
}

function printTokens(file: SourceFile): void {
  const { tokens, diagnostics } = tokenize(file.text);

  for (const token of tokens) {
    const { line, column } = file.position(token.start);
    const text = token.kind === ';' && token.text === '' ? '(newline)' : JSON.stringify(token.text);

    console.log(`${line}:${column}`.padEnd(8) + token.kind.padEnd(16) + text);
  }

  reportDiagnostics(file, diagnostics);
}

function printAst(file: SourceFile, markup: boolean): void {
  const { program, diagnostics } = parse(file.text, { markup });
  // Positions are left out and identifiers printed as plain names to keep the output readable.
  const compact = (key: string, value: unknown): unknown => {
    if (key === 'start' || key === 'end' || key === 'raw') return undefined;
    if (typeof value === 'object' && value !== null && 'kind' in value && 'name' in value) {
      if (value.kind === 'Identifier') return value.name;
    }

    return value;
  };

  console.log(JSON.stringify(program, compact, 2));
  reportDiagnostics(file, diagnostics);
}

function reportDiagnostics(file: SourceFile, diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) console.error(`${formatDiagnostic(file, diagnostic)}\n`);
  if (diagnostics.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (err: unknown) {
  if (err instanceof CompileError) console.error(err.message);
  else if (err instanceof UsageError) console.error(`rook: ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
}
