import { rook, type BunPlugin } from './bun.ts';

// `preload = ["rooklang/bun/register"]` in bunfig.toml: Bun then compiles `.rk` modules when they
// load, in `bun app.rk`, in imports from TypeScript and in `bun test` (bun.ts). `rook run` under
// Bun preloads it too, and the workers of `go` import it before their module.

const { Bun } = globalThis as unknown as { Bun?: { plugin(plugin: BunPlugin): void } };

if (Bun === undefined) {
  throw new Error('rooklang/bun/register is for Bun; in Node, rook run compiles .rk files');
}

Bun.plugin(rook());
