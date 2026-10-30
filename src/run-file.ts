import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unwatchFile,
  watchFile,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayPath } from './build.ts';

// `rook run`: the program runs in a process of its own that imports loader.ts first, and so do
// the worker threads of its goroutines, which do not share the hooks of the thread that registers
// them. Under Bun, the process is Bun's and preloads its plugin, bun-register.ts, which the workers
// import too. They take the compiled code from a directory of the run, removed after it.
//
// The program may listen to signals with signal(): Ctrl+C reaches it as it reaches this process,
// since a terminal sends it to both, and the signals that a process manager sends here go on to
// it, so this one waits for it. With --watch, a change of a file that the program compiled or read
// (the loader lists them) stops it with SIGTERM and runs it again; between runs this one waits for
// changes, and Ctrl+C ends it.

export interface RunOptions {
  typeCheck: boolean;
  markup: boolean | undefined;
  watch: boolean;
}

/** The signals that `rook run` gives to the program, or leaves to it, rather than ending at them. */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** How often the files are looked at, and how long a program has to stop before it is killed. */
const POLL_MS = 200;
const KILL_MS = 2000;

export function runFile(file: string, options: RunOptions): void {
  // The build rewrites the extensions of imports, not of these URLs: in the package they are .js.
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const loader = new URL(`./loader${extension}`, import.meta.url).href;
  // Under Bun the program runs in Bun, with its plugin preloaded instead of the hooks of Node.
  const bun = process.versions['bun'] !== undefined;
  const register = fileURLToPath(new URL(`./bun-register${extension}`, import.meta.url));
  const run = fileURLToPath(new URL(`./run${extension}`, import.meta.url));
  const watched = new Set<string>();
  let child: ChildProcess | null = null;
  let cache = '';
  let restart: string | null = null;
  let stopping = false;
  let killer: NodeJS.Timeout | undefined;

  // The files of the run and the time each was changed when it was compiled.
  const files = (): [string, number][] =>
    existsSync(join(cache, 'files'))
      ? readFileSync(join(cache, 'files'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('\t'))
          .map(([path, time]) => [path!, Number(time)])
      : [];

  // A file is compared with what was compiled, as it may change before it is watched.
  const watch = ([path, compiled]: [string, number]) => {
    if (!watched.has(path)) {
      watched.add(path);
      watchFile(path, { interval: POLL_MS }, (now, before) => {
        if (now.mtimeMs !== before.mtimeMs) changed(path);
      });
    }

    if (existsSync(path) && statSync(path).mtimeMs !== compiled) changed(path);
  };

  const changed = (path: string) => {
    if (stopping || restart !== null) return;
    restart = path;
    if (child === null) {
      start();

      return;
    }

    child.kill('SIGTERM');
    killer = setTimeout(() => child?.kill('SIGKILL'), KILL_MS);
  };

  const stop = () => {
    stopping = true;
    for (const path of watched) unwatchFile(path);
    unwatchFile(join(cache, 'files'));
  };

  const forward = (name: NodeJS.Signals) => {
    // Without --watch Ctrl+C is the program's; with it, it ends the watching too.
    if (name !== 'SIGINT') child?.kill(name);
    if (options.watch) stop();
    if (options.watch && child === null) process.exitCode = 0;
  };

  const start = () => {
    if (restart !== null) console.error(`rook: ${displayPath(restart)} changed, running again`);
    restart = null;
    cache = mkdtempSync(join(tmpdir(), 'rook-run-'));

    const args = bun
      ? ['--preload', register, run, file]
      : ['--enable-source-maps', '--import', loader, run, file];

    child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ROOK_RUN_CACHE: cache,
        ...(options.typeCheck ? {} : { ROOK_NO_CHECK: '1' }),
        ...(options.markup === undefined ? {} : { ROOK_MARKUP: options.markup ? '1' : '0' }),
      },
    });
    // The files of the program are watched as it loads them.
    if (options.watch) {
      watchFile(join(cache, 'files'), { interval: POLL_MS }, () => files().forEach(watch));
    }

    child.on('close', (status, signal) => {
      clearTimeout(killer);
      if (options.watch) files().forEach(watch);
      unwatchFile(join(cache, 'files'));
      rmSync(cache, { recursive: true, force: true });
      child = null;
      if (!options.watch || stopping) {
        for (const name of SIGNALS) process.off(name, forward);
        process.exitCode = status ?? (signal ? 1 : 0);
      } else if (restart !== null) {
        start();
      } else {
        console.error('rook: waiting for a change to run again');
      }
    });
  };

  for (const name of SIGNALS) process.on(name, forward);
  start();
}
