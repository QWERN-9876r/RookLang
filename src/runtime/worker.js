// The worker: runs the calls the pool sends, reports their results and forwards trace events.

import {
  $$adopt,
  $$connect,
  $$gone,
  $$incoming,
  $$post,
  $$reclassed,
  $$registry,
} from './threads.js';
import { $$tracer } from './trace.js';

export async function $$serve(functions) {
  // Traced in one thread, the functions run where `go` is called (trace.js).
  const inline = $$tracer()?.inline;

  if (inline) return void Object.assign(inline, functions);

  const threads = 'node:worker_threads';
  const port =
    typeof postMessage === 'function'
      ? globalThis
      : (await import(/* @vite-ignore */ threads)).parentPort;
  const registry = $$registry();
  const traceKey = Symbol.for('rook.trace');
  let actor;
  let traceId;
  let nested = 0;
  const children = new Set();
  const childWaiters = [];
  const trace = {
    actor: () => actor,
    get id() {
      return traceId;
    },
    emit(event, id = traceId) {
      if (event.kind === 'end' && children.delete(event.actor) && children.size === 0) {
        childWaiters.splice(0).forEach((resolve) => resolve());
      }

      port.postMessage({ trace: event, traceId: id });
    },
    go(name, line, args) {
      const task = `${actor}/${name}-${++nested}`;

      children.add(task);
      trace.emit({ kind: 'go', actor, task, line, args });

      return task;
    },
    run: (_actor, run) => run(),
  };
  const waitForChildren = () =>
    children.size === 0 ? Promise.resolve() : new Promise((resolve) => childWaiters.push(resolve));

  // The port to the main thread keeps the worker running.
  registry.idle = (key) => key !== registry.main && registry.ports.get(key)?.unref?.();
  port.postMessage({ hello: registry.key });

  const free = () => port.postMessage({ free: true, owns: registry.states.size > 0 });
  const receive = async (data) => {
    if ('route' in data || 'op' in data || 'answer' in data) return $$incoming(registry.main, data);
    if ('init' in data) {
      registry.main = data.init;

      return $$connect(data.init, port, false);
    }

    if ('port' in data) return $$connect(data.port, data.through, true);
    if ('gone' in data) return $$gone(data.gone);
    if (data.actor !== undefined) {
      actor = data.actor;
      traceId = data.traceId;
      globalThis[traceKey] = trace;
    }

    setTimeout(free);
    $$adopt(data.args);
    $$reclassed(data);

    const { main } = registry;

    try {
      const value = await functions[data.name](...data.args);

      if (data.actor !== undefined) await waitForChildren();

      if (data.actor !== undefined) {
        trace.emit({ kind: 'return', actor, value });
        trace.emit({ kind: 'end', actor });
      }

      $$post(main, { returned: data.call, value, owns: registry.states.size > 0 }, false);
    } catch (error) {
      if (data.actor !== undefined) trace.emit({ kind: 'end', actor });
      try {
        $$post(main, { returned: data.call, error, owns: registry.states.size > 0 }, false);
      } catch {
        $$post(main, { returned: data.call, error: new Error(String(error)), owns: true }, false);
      }
    }
  };

  if (port.on) port.on('message', receive);
  else port.onmessage = (event) => receive(event.data);
}
