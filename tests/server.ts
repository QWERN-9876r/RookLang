import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { compile } from '../src/index.ts';

// Helpers of the tests of components on the server ("rook": { "markup": "html" }, docs/server.md).

/** Errors of a module compiled for the server. */
export function serverErrors(source: string): string[] {
  return compile(source, { markup: 'html' }).diagnostics.map((d) => d.message);
}

/** The JS of a module compiled for the server, with the runtime in it. */
export function serverJs(source: string): string {
  const { code, diagnostics } = compile(source, { markup: 'html', runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  return code;
}

/** Runs a module compiled for the server, which may await at the top level; what it printed. */
export async function runOnServer(source: string): Promise<string[]> {
  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  const prototype = Object.getPrototypeOf(async () => {}) as { constructor: unknown };
  const AsyncFunction = prototype.constructor as new (
    ...args: string[]
  ) => (console: unknown) => Promise<void>;

  await new AsyncFunction('console', serverJs(source))({ log });

  return output;
}

/**
 * A server project: its package.json turns on markup as HTML, and its node_modules has this
 * package, so that the built code finds "rooklang/runtime" and "rooklang/server".
 */
export function serverProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rook-server-'));

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ type: 'module', rook: { markup: 'html' } }),
  );
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(
    new URL('..', import.meta.url).pathname,
    join(dir, 'node_modules', 'rooklang'),
    'dir',
  );

  return dir;
}

let modules = 0;

/** Builds a module of a server project and imports it. */
export async function importServer(source: string): Promise<Record<string, unknown>> {
  const dir = serverProject();
  const filename = join(dir, `app${modules++}.rk`);

  writeFileSync(filename, source);

  const { code, diagnostics } = compile(source, { filename });

  expect(diagnostics).toEqual([]);
  writeFileSync(filename.replace(/\.rk$/, '.js'), code);

  return (await import(filename.replace(/\.rk$/, '.js'))) as Record<string, unknown>;
}

/** The function of `export const handle = handler(App)` of a module. */
export async function handlerOf(source: string): Promise<(request: Request) => Promise<Response>> {
  const module = await importServer(source);

  return module.handle as (request: Request) => Promise<Response>;
}

/** A GET request of a path. */
export function get(path: string): Request {
  return new Request(`http://localhost${path}`);
}
