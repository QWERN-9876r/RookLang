// Tracing: what the goroutines and the channels of a program do, told to whoever listens. A
// listener is a value in `globalThis` under Symbol.for('rook.trace'), shared by the modules of a
// thread like the registry of threads.js; without one nothing is traced, and an operation pays for
// one look at `globalThis`. This is what the scenes of the documentation site are recorded with
// (src/trace) and the base of debugging goroutines; it is not a public API before 1.0.
//
// A listener has:
//
//   emit(event)      an event of this thread, see below
//   actor()          the id of the goroutine that runs now
//   go(name, line)   `go` of the goroutine that runs now: the listener names the new goroutine and
//                    gives back its id
//   turn(line)      an `await` starts; returns the task id for its later resume(line)
//   track(task, id)  remembers the Promise of a goroutine for cancel(task, line)
//   cancel(task, line) `cancel` of the goroutine that runs now
//   run(actor, fn)   runs fn as actor; used when tracing goroutines in one thread
//   inline           if it is an object, `go` runs in this thread: the worker modules put their
//                    functions into it instead of serving a pool (go.js)
//
// The events of the runtime; `line` is the line of the operation in the source, which code
// compiled with the option `trace` passes, and `actor` is who did it:
//
//   { kind: 'chan', channel, name, size, line }             a channel is made
//   { kind: 'wait', actor, op: 'send' | 'receive', channel, line }   an operation cannot go on yet
//   { kind: 'pass', actor, channel, from, to, value, line } a value goes through a channel: from
//                    hand to hand, into the buffer (`to` is null) or out of it (`from` is null)
//   { kind: 'close', actor, channel, line }                 close(channel)
//   { kind: 'select', actor, line, lines }                  the possible cases of a select
//   { kind: 'turn', actor, task, phase, line }              an async task waits or resumes
//   { kind: 'publish', actor, topic, value, line }           a value goes to every topic listener
//   { kind: 'cancel', actor, task, line }                    one goroutine cancels another

export const $$traceKey = Symbol.for('rook.trace');

/** The listener of this thread, or undefined. */
export function $$tracer() {
  return globalThis[$$traceKey];
}

/** Reports a reactive change or dependent update to a listener, if there is one. */
export function $$traceReactive(event) {
  $$tracer()?.reactive?.(event);
}

/** Keeps a traced await at its source line while asynchronous tasks take turns. */
export function $$traceAwait(value, line) {
  const trace = $$tracer();

  if (!trace?.turn) return value;

  const task = trace.turn(line);
  const awaited = Promise.resolve(value);

  awaited.then(
    () => trace.resume(task, line),
    () => trace.resume(task, line),
  );

  return awaited;
}

/**
 * Who does an operation and where, kept with it while it waits in the queue of its channel, or
 * undefined without a listener. `order` tells which of two operations came later: that one made
 * the move.
 */
export function $$place(registry, line) {
  const trace = $$tracer();

  return trace && { actor: trace.actor(), line, order: registry.order++, passed: false };
}
