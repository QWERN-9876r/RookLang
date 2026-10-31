import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// Packages of types that are laid out as @types/bun is: `@types/run` only refers to `run-types`,
// which declares the module with `declare module "run"` and its global with `export import`.

const RUN_TYPES = `/// <reference path="./run.d.ts" />
/// <reference path="./global.d.ts" />
`;

const RUN = `declare module "run" {
  export interface File { size: number; name: string }
  export function file(path: string): File;
  export const version: string;
  interface Base { port?: number }
  interface WithFetch<Data> extends Base { fetch(request: Request, data: Data): Response; unix?: never }
  interface WithUnix<Data> { unix: string; fetch(request: Request, data: Data): Response; port?: never }
  export function serve<Data = undefined>(options: WithFetch<Data> | WithUnix<Data>): { port: number };
}
`;

const GLOBAL = `import * as RunModule from "run";
declare global {
  export import Run = RunModule;
}
`;

let project: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), text);
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'rook-run-'));
  write('node_modules/@types/run/package.json', '{ "name": "@types/run", "types": "index.d.ts" }');
  write('node_modules/@types/run/index.d.ts', '/// <reference types="run-types" />\n');
  write('node_modules/run-types/package.json', '{ "name": "run-types", "types": "index.d.ts" }');
  write('node_modules/run-types/index.d.ts', RUN_TYPES);
  write('node_modules/run-types/run.d.ts', RUN);
  write('node_modules/run-types/global.d.ts', GLOBAL);
});

function errors(source: string): string[] {
  return compile(source, { filename: join(project, 'main.rk') }).diagnostics.map((d) => d.message);
}

describe('a package of types that refers to another one', () => {
  it('types the module it declares', () => {
    expect(
      errors(`import { file, version } from "run"
const size number = file("a.txt").size
const n number = file
const v string = version`),
    ).toEqual(['cannot use func(string) File as number']);
  });

  it('types the global it declares with export import', () => {
    expect(
      errors(`const v string = Run.version
const name number = Run.file("a.txt").name`),
    ).toEqual(['cannot use string as number']);
  });

  it('gives fields of an object literal their types from a union of options', () => {
    expect(
      errors(`const server = Run.serve({
    port: 3000,
    fetch: (request, data) => new Response(request.url),
})
const port number = server.port`),
    ).toEqual([]);
  });
});
