// `go`: the pool of workers of the program, and the side of the worker. They work
// with Web Workers and with the worker threads of Node, whose API differs: `on("message")` instead
// of `onmessage`, and `unref()`, so that idle workers do not keep the program running.

import {
  $$adopt,
  $$connect,
  $$copy,
  $$gone,
  $$incoming,
  $$post,
  $$registry,
  $$transfer,
} from './threads.js';

// `go` in a module: a call in a worker of the pool. `start` starts a worker of the module, with its
// worker module: it is $$startWorker of the module, whose URL a bundler needs to see there.
export function $$goWorker(start, name, args) {
  return (globalThis[Symbol.for('rook.goroutines')] ??= $$pool()).call(
    start,
    name,
    $$copy(args, true),
  );
}

// The workers of the program, shared by its modules: up to one per processor. Each runs the worker
// module of one module, `start`. Calls wait in one queue and go to a worker of their module that is
// free: one whose thread is not running code, though its earlier calls may wait in `await`. A
// worker that is still busy keeps its calls for later; an idle worker of another module makes room
// for a new one, unless it keeps channels.
export function $$pool() {
  const size = globalThis.navigator?.hardwareConcurrency ?? 4;
  const registry = $$registry();
  const workers = [];
  const queue = [];
  const calls = new Map();
  let ids = 0;
  // A worker without calls lets the program end, unless something here waits for it.
  const unref = (worker) => {
    if (worker.calls === 0 && !(registry.pins.get(worker.key) > 0)) worker.thread.unref?.();
  };

  registry.idle = (key) => {
    const worker = workers.find((each) => each.key === key);

    if (worker) unref(worker);
  };

  const send = (worker, call) => {
    worker.busy = true;
    worker.calls++;
    worker.thread.ref?.();
    call.worker = worker;
    calls.set(call.id, call);
    $$post(worker.key, { call: call.id, name: call.name, args: call.args });
    call.args = null;
  };
  const dispatch = () => {
    const starting = new Map();

    for (const worker of workers) {
      if (!worker.key) starting.set(worker.start, (starting.get(worker.start) ?? 0) + 1);
    }

    for (let i = 0; i < queue.length; i++) {
      const call = queue[i];
      let free = null;

      for (const worker of workers) {
        if (worker.start !== call.start || !worker.key || worker.busy) continue;
        if (!free || worker.calls < free.calls) free = worker;
      }

      // A free worker without calls; else a new worker; else one whose calls wait in await.
      if (free?.calls === 0 || (free && workers.length >= size)) {
        queue.splice(i--, 1);
        send(free, call);
      } else if (starting.get(call.start) > 0) {
        starting.set(call.start, starting.get(call.start) - 1);
      } else if (workers.length < size || retire(call.start)) {
        add(call.start);
      } else {
        // It waits for a busy worker of its module, which may have let go of the program when
        // its last call returned: the program runs on until that worker is free and takes it.
        for (const worker of workers)
          if (worker.start === call.start && worker.key) worker.thread.ref?.();
      }
    }
  };
  const retire = (start) => {
    const idle = workers.find(
      (worker) =>
        worker.key && worker.start !== start && !worker.busy && worker.calls === 0 && !worker.owns,
    );

    if (!idle) return false;
    idle.thread.terminate();
    remove(idle, null);

    return true;
  };
  // A worker that stopped: its calls fail, and the threads that talked to it forget it.
  const remove = (worker, error) => {
    workers.splice(workers.indexOf(worker), 1);
    for (const [id, call] of calls) {
      if (call.worker !== worker) continue;
      calls.delete(id);
      call.reject(error);
    }

    if (worker.key) {
      $$gone(worker.key);
      for (const other of workers) {
        if (other.key) other.thread.postMessage({ gone: worker.key });
      }
    }
  };
  const fail = (worker, error) => {
    remove(worker, error);
    dispatch();
  };
  const receive = (worker, data) => {
    if ('op' in data || 'answer' in data) return $$incoming(worker.key, data);
    if ('hello' in data) {
      worker.key = data.hello;
      $$connect(worker.key, worker.thread, false);
      worker.thread.postMessage({ init: registry.key });
      // Workers talk to each other through ports of their own, also while this thread is busy.
      for (const other of workers) {
        if (other === worker || !other.key) continue;

        const { port1, port2 } = new MessageChannel();

        worker.thread.postMessage({ port: other.key, through: port1 }, [port1]);
        other.thread.postMessage({ port: worker.key, through: port2 }, [port2]);
      }

      worker.busy = false;
      unref(worker);
    } else if ('free' in data) {
      worker.busy = false;
      worker.owns = data.owns;
    } else if ('returned' in data) {
      $$adopt(data);

      const call = calls.get(data.returned);

      calls.delete(data.returned);
      worker.owns = data.owns;
      worker.calls--;
      unref(worker);
      if ('error' in data) call?.reject(data.error);
      else call?.resolve(data.value);
    }

    dispatch();
    // A worker that a waiting call held on to, now free and without a call, lets go again.
    if ('free' in data) unref(worker);
  };
  const add = (start) => {
    const worker = { start, key: null, thread: null, busy: true, calls: 0, owns: false };

    workers.push(worker);
    start().then(
      (thread) => {
        worker.thread = thread;
        if (thread.on) {
          thread.on('message', (data) => receive(worker, data));
          thread.on('error', (error) => fail(worker, error));
        } else {
          thread.onmessage = (event) => receive(worker, event.data);
          thread.onerror = (event) => fail(worker, new Error(event.message ?? 'a worker failed'));
        }
      },
      (error) => {
        remove(worker, error);
        for (const call of queue.filter((each) => each.start === start)) {
          queue.splice(queue.indexOf(call), 1);
          call.reject(error);
        }
      },
    );
  };
  const tasks = new WeakMap();

  return {
    call: (start, name, args) => {
      const call = { id: ids++, start, name, args, resolve: null, reject: null, worker: null };
      const task = new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));

      tasks.set(task, call);
      queue.push(call);
      dispatch();

      return task;
    },
    // A call that waits leaves the queue; a worker cannot stop a call, so the worker stops, and
    // the other calls in it fail too.
    cancel: (task) => {
      const call = tasks.get(task);

      tasks.delete(task);
      if (!call || (!queue.includes(call) && !calls.has(call.id))) return;
      task.catch(() => {});
      if (queue.includes(call)) {
        queue.splice(queue.indexOf(call), 1);

        return call.reject(new Error('goroutine cancelled'));
      }

      calls.delete(call.id);
      call.reject(new Error('goroutine cancelled'));
      call.worker.thread.terminate();
      remove(
        call.worker,
        new Error('the worker of the goroutine stopped: another goroutine in it was cancelled'),
      );
      dispatch();
    },
  };
}

// `go` inside a goroutine: the function runs in the same worker, with copies of the arguments. A
// name is one of the `functions` of the worker module, a function literal is itself.
export function $$goHere(functions, fn, args) {
  const copies = $$copy(args);
  const run = typeof fn === 'function' ? fn : functions[fn];
  let cancel;
  const cancelled = new Promise((_, reject) => (cancel = reject));
  const task = Promise.race([cancelled, Promise.resolve().then(() => cancel && run(...copies))]);

  $$registry().cancels.set(task, () => {
    task.catch(() => {});
    cancel(new Error('goroutine cancelled'));
    cancel = null;
  });

  return task;
}

// `go for`: the array is split into parts, each part runs as a goroutine of `go` of the module, and
// the loop waits for all of them. The pool gives a part to the first worker that is free, so with
// several parts per processor the workers end at about the same time, also when some elements take
// longer than others or some processors are slower. The names that the body uses are copied with
// each part: if one of them is an object, which may be large, there is one part per processor. A
// typed array on a SharedArrayBuffer is shared with the workers, which write into it; other parts
// are copies, moved to the workers and back into the array.
export async function $$goFor(go, name, items, ...captured) {
  const partsPerProcessor = 4;
  const processors = globalThis.navigator?.hardwareConcurrency ?? 4;
  const small = captured.every((value) => typeof value !== 'object' || value === null);
  const count = Math.min(small ? processors * partsPerProcessor : processors, items.length);
  const shared =
    typeof SharedArrayBuffer === 'function' && items.buffer instanceof SharedArrayBuffer;
  const parts = [];

  for (let k = 0; k < count; k++) {
    const from = Math.floor((items.length * k) / count);
    const to = Math.floor((items.length * (k + 1)) / count);
    const part = shared ? items.subarray(from, to) : items.slice(from, to);

    if (ArrayBuffer.isView(part) && !shared) $$transfer(part);
    parts.push(
      go(name, [part, from, ...captured]).then((written) => {
        if (written === undefined || shared) return;
        if (ArrayBuffer.isView(items)) items.set(written, from);
        else for (let i = 0; i < written.length; i++) items[from + i] = written[i];
      }),
    );
  }

  await Promise.all(parts);
}

// `make([]T, n, shared)`: the memory of a typed array that the workers of `go for` write into,
// without copies. A page has SharedArrayBuffer only with cross-origin isolation.
export function $$shared(bytes) {
  if (typeof SharedArrayBuffer !== 'function') {
    throw new Error(
      'make(..., shared) needs SharedArrayBuffer, which a page has only with cross-origin isolation: the headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp',
    );
  }

  return new SharedArrayBuffer(bytes);
}

// The worker: runs the calls that the pool sends and sends back their results or errors. Once the
// thread is free again, it says so, and the pool may send another call.
export async function $$serve(functions) {
  const threads = 'node:worker_threads';
  const port =
    typeof postMessage === 'function'
      ? globalThis
      : (await import(/* @vite-ignore */ threads)).parentPort;
  const registry = $$registry();

  // The port to the main thread keeps the worker running.
  registry.idle = (key) => key !== registry.main && registry.ports.get(key)?.unref?.();
  port.postMessage({ hello: registry.key });

  const free = () => port.postMessage({ free: true, owns: registry.states.size > 0 });
  const receive = async (data) => {
    if ('op' in data || 'answer' in data) return $$incoming(registry.main, data);
    if ('init' in data) {
      registry.main = data.init;

      return $$connect(data.init, port, false);
    }

    if ('port' in data) return $$connect(data.port, data.through, true);
    if ('gone' in data) return $$gone(data.gone);
    setTimeout(free);
    $$adopt(data.args);

    const { main } = registry;

    try {
      const value = await functions[data.name](...data.args);

      $$post(main, { returned: data.call, value, owns: registry.states.size > 0 });
    } catch (error) {
      try {
        $$post(main, { returned: data.call, error, owns: registry.states.size > 0 });
      } catch {
        $$post(main, { returned: data.call, error: new Error(String(error)), owns: true });
      }
    }
  };

  if (port.on) port.on('message', receive);
  else port.onmessage = (event) => receive(event.data);
}

// `cancel(task)`: stops a goroutine of `go`, whose Promise fails with "goroutine cancelled". A call
// in a worker stops with its worker; inside a goroutine, `go` runs in the same worker, so its
// Promise fails but code that has started goes on.
export function $$cancel(task) {
  globalThis[Symbol.for('rook.goroutines')]?.cancel(task);
  $$registry().cancels.get(task)?.();
}
