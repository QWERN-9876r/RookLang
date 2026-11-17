import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileModule, type Markup } from '../compile.ts';
import { formatDiagnostic } from '../diagnostics.ts';
import { SourceFile } from '../source.ts';
import type { Trace } from './model.ts';

// Recording a trace: the program is compiled with the option `trace` and run by runner.js in a
// process of its own, with all its goroutines in one thread, so that the same program always
// gives the same trace. The documentation site records the traces of its scenes this way when
// it is built. Node only, and not a public API before 1.0.

export interface RecordOptions {
  /** Markup and components; off by default. */
  markup?: Markup;
  /** How long the program may run, in milliseconds; 10 seconds by default. */
  timeout?: number;
  /** The name of the program in the messages about it, `scene.rk`. */
  name?: string;
  /** Use real workers instead of one thread; for checking the live trace path. */
  workers?: boolean;
}

/**
 * The trace of a program of one module: what its goroutines and channels did, or that they came
 * to a stalemate. Fails if the program does not compile, throws, or runs longer than `timeout`.
 */
export async function recordTrace(source: string, options: RecordOptions = {}): Promise<Trace> {
  const name = options.name ?? 'main.rk';
  // The modules are `.mjs`, so that Node takes them for ES modules wherever they are.
  const compiled = compileModule(source, {
    trace: true,
    runtime: 'inline',
    markup: options.markup ?? false,
    workerUrl: './main.worker.mjs',
    sourceName: name,
  });

  if (compiled.diagnostics.length > 0) {
    const file = new SourceFile(name, source);
    const messages = compiled.diagnostics.map((diagnostic) => formatDiagnostic(file, diagnostic));

    throw new Error(`cannot record a trace of ${name}:\n${messages.join('\n')}`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'rook-trace-'));
  const main = join(dir, 'main.mjs');
  const worker = join(dir, 'main.worker.mjs');
  const output = join(dir, 'trace.json');

  try {
    writeFileSync(main, compiled.code);
    if (compiled.worker !== undefined) writeFileSync(worker, compiled.worker);

    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          fileURLToPath(new URL('./runner.js', import.meta.url)),
          pathToFileURL(main).href,
          compiled.worker === undefined ? '-' : pathToFileURL(worker).href,
          output,
          options.workers ? 'workers' : 'inline',
        ],
        { timeout: options.timeout ?? 10_000 },
        (error, _stdout, stderr) => {
          if (!error) resolve();
          else if (error.killed) reject(new Error(`${name} ran too long to record its trace`));
          else reject(new Error(`${name} failed while its trace was recorded:\n${stderr}`));
        },
      );
    });

    return JSON.parse(readFileSync(output, 'utf8')) as Trace;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
