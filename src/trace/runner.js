// Runs a compiled program and writes down its trace: `node runner.js <main> <worker | -> <out>`,
// where the first two are the URLs of the module of the program and of its worker module, compiled
// with the option `trace` and the runtime in them, and the last is the file for the trace as JSON.
// record.ts starts this in a process of its own.
//
// All the goroutines run in this one thread (`inline` of src/runtime/trace.js), so the order of
// the moves is the same every time, and AsyncLocalStorage tells which goroutine runs. When the
// thread has nothing left to do and `main` has not finished, every goroutine waits on a channel
// for ever: a stalemate.

import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const [main, worker, output, mode] = process.argv.slice(2);
const running = new AsyncLocalStorage();
/** The events of the runtime, with its ids of channels. */
const events = [];
const channels = [];
const goroutines = [];
const parents = new Map();
const tasks = new WeakMap();
/** How many goroutines each function has started. */
const started = new Map();
let mainEnded = false;
let turns = 0;

function remember(event) {
  if (event.kind === 'chan') {
    channels.push(event);

    return;
  }

  if (event.kind === 'publish') {
    let channel = channels.find((each) => each.name === event.topic);

    if (!channel) {
      channel = { channel: `topic:${event.topic}`, name: event.topic, size: 0 };
      channels.push(channel);
    }

    event.channel = channel.channel;
    delete event.topic;
  }

  if (event.kind === 'go') {
    parents.set(event.task, { actor: event.actor, line: event.line });
    if (event.args?.length) event.args = event.args.map(textOf).join(', ');
  }

  if (event.kind === 'return') {
    const parent = parents.get(event.actor);

    event.to = parent?.actor ?? 'main';
    event.line = parent?.line ?? 0;
  }

  events.push(event);
  if (event.kind === 'go' && !goroutines.some((goroutine) => goroutine.id === event.task)) {
    const name = event.task.split(/[:/]/).at(-1).replace(/-\d+$/, '');

    goroutines.push({ id: event.task, name, count: 1 });
  }
}

globalThis[Symbol.for('rook.trace')] = {
  ...(mode === 'inline' ? { inline: {} } : {}),
  emit(event) {
    remember(event);
  },
  actor: () => running.getStore() ?? 'main',
  go(name, line, args) {
    const count = (started.get(name) ?? 0) + 1;
    const id = `${name}-${count}`;

    started.set(name, count);
    goroutines.push({ id, name, count });
    remember({ kind: 'go', actor: this.actor(), task: id, line, args });

    return id;
  },
  turn(line) {
    const task = ++turns;

    this.emit({ kind: 'turn', actor: this.actor(), task, phase: 'wait', line });

    return task;
  },
  resume(task, line) {
    this.emit({ kind: 'turn', actor: this.actor(), task, phase: 'resume', line });
  },
  track(task, actor) {
    tasks.set(task, actor);
  },
  cancel(task, line) {
    const actor = tasks.get(task);

    if (actor !== undefined) this.emit({ kind: 'cancel', actor: this.actor(), task: actor, line });
  },
  run: (actor, run) => running.run(actor, run),
};

// What the program prints is not part of its trace.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  globalThis.console[method] = () => {};
}

/** What a tile of the board shows for a value: short, whatever the value is. */
function textOf(value) {
  if (typeof value === 'string') return value.length > 8 ? `${value.slice(0, 7)}…` : value;
  if (value === undefined || value === null) return String(value);
  if (Array.isArray(value)) return '[…]';
  if (typeof value === 'object' && value !== null) return '{…}';

  return String(value);
}

/** The trace: goroutines and channels under short ids, and the values as text. */
function trace() {
  const named = new Map();

  for (const { name } of channels) named.set(name, (named.get(name) ?? 0) + 1);

  const ids = new Map();
  const seen = new Map();
  const listed = channels.map(({ channel, name, size }, index) => {
    const count = (seen.get(name) ?? 0) + 1;
    const base = name === '' ? `chan-${index + 1}` : name;
    // Two channels made for variables of one name get numbers.
    const id = name !== '' && named.get(name) > 1 ? `${name}-${count}` : base;

    seen.set(name, count);
    ids.set(channel, id);

    return { id, label: id.replaceAll('-', ' '), size: Number.isFinite(size) ? size : 0 };
  });

  return {
    actors: [
      { id: 'main', label: 'main' },
      ...goroutines.map(({ id, name, count }) => ({
        id,
        label: started.get(name) > 1 ? `${name} ${count}` : name,
      })),
    ],
    channels: listed,
    events: events.map((event) => ({
      ...event,
      ...('channel' in event ? { channel: ids.get(event.channel) ?? event.channel } : {}),
      ...('value' in event ? { value: textOf(event.value) } : {}),
    })),
  };
}

let written = false;

// The thread has nothing left to do: the program is over, or it hangs.
process.on('beforeExit', () => {
  if (written) return;
  written = true;
  if (!mainEnded) events.push({ kind: 'stalemate' });
  writeFileSync(output, JSON.stringify(trace()));
});

// The worker module puts the functions of `go` into `inline`, then the program runs as `main`.
if (worker !== '-' && mode === 'inline') await import(worker);

// Not awaited here: a program that hangs would leave this module waiting too, which Node takes
// for a failure, and its stalemate is what has to be written down.
running
  .run('main', () => import(main))
  .then(() => {
    mainEnded = true;
    events.push({ kind: 'end', actor: 'main' });
  })
  .catch((error) => {
    written = true;
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
