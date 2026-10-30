import { describe, expect, it } from 'vitest';

// The pool of workers of `go` (src/runtime/go.js): a worker that fails before it starts, as when
// its module does not load, fails the calls that wait for it, instead of being started again.

interface Pool {
  call(start: () => Promise<unknown>, name: string, args: unknown[]): Promise<unknown>;
}

// The runtime is plain JS without types.
const runtime = '../src/runtime/go.js';
const { $$pool } = (await import(runtime)) as { $$pool: () => Pool };

describe('the pool of workers', () => {
  it('fails the calls of a worker that cannot start, instead of starting it again', async () => {
    let started = 0;
    // A Web Worker whose module does not load: it fires `error` and never says hello.
    const start = () => {
      started++;

      return Promise.resolve({
        postMessage() {},
        terminate() {},
        set onerror(listener: (event: { message: string }) => void) {
          setTimeout(() => listener({ message: 'Cannot find module "app.rk.goroutines.js"' }));
        },
      });
    };
    const pool = $$pool();

    await expect(pool.call(start, 'square', [2])).rejects.toThrow('Cannot find module');
    await expect(pool.call(start, 'square', [3])).rejects.toThrow('Cannot find module');
    expect(started).toBe(2);
  });
});
