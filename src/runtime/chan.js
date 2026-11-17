// Channels: sending, receiving and closing, here or in the thread that made the channel
// (threads.js), and the queues of a channel. Receiving from a closed channel gives
// the zero value of its type, as in Go. Channel.EMPTY is closed and belongs to no thread: a send to
// it goes nowhere, and receiving gives the zero value that the code that receives passes.

import { $$deque } from './queue.js';
import { $$commit, $$lock, $$select, $$try, $$unlock, $$unwait } from './select.js';
import { $$adopt, $$ask, $$isEmpty, $$ownerOf, $$post, $$registry, $$stopped } from './threads.js';
import { $$place, $$tracer } from './trace.js';

$$registry().handle ??= { message: $$message, pump: $$pump };

// `name` and `line` are the variable the channel is made for and its line, from code compiled with
// the option `trace`: a listener is told about the channel (trace.js).
export function $$chan(size, zero, name, line) {
  const registry = $$registry();
  const id = `${registry.key}:${registry.channels++}`;
  const channel = { $$chan: id, size, zero };

  registry.states.set(id, {
    size,
    zero,
    buffer: new $$deque(),
    receivers: new $$deque(),
    senders: new $$deque(),
    closed: false,
    holders: 1,
    busy: false,
  });
  $$adopt(channel);
  $$tracer()?.emit({ kind: 'chan', channel: id, name: name ?? '', size, line });

  return channel;
}

// A local operation waits in the queue of its channel; one of another thread asks the thread
// that made the channel.
export function $$send(channel, value, line) {
  const id = channel.$$chan;

  if ($$isEmpty(id)) return Promise.resolve();

  const registry = $$registry();
  const owner = $$ownerOf(id);
  const at = $$place(registry, line);

  if (owner !== registry.key) return $$ask(owner, { op: 'send', channel: id, value, at });

  return new Promise((resolve, reject) =>
    $$wait(id, 'senders', { value, done: resolve, fail: reject, at }),
  );
}

export function $$receive(channel, withOk = false, zero = null, line) {
  const id = channel.$$chan;
  const registry = $$registry();
  const owner = $$ownerOf(id);
  const at = $$isEmpty(id) ? undefined : $$place(registry, line);
  const received = $$isEmpty(id)
    ? Promise.resolve([zero, false])
    : owner !== registry.key
      ? $$ask(owner, { op: 'receive', channel: id, at })
      : new Promise((resolve, reject) =>
          $$wait(id, 'receivers', { done: resolve, fail: reject, at }),
        );

  return withOk ? received : received.then(([value]) => value);
}

// Closing a channel of another thread fails this one if it was closed already, as a panic would.
export function $$close(channel, line) {
  const id = channel.$$chan;

  if ($$isEmpty(id)) return;

  const registry = $$registry();
  const owner = $$ownerOf(id);
  const at = $$place(registry, line);

  if (owner === registry.key) return $$closeHere(id, at);
  $$ask(owner, { op: 'close', channel: id, at }).catch((error) => {
    setTimeout(() => {
      throw error;
    });
  });
}

export function $$closeHere(id, at) {
  const state = $$registry().states.get(id);

  if (state.closed) throw new Error('close of a closed channel');
  state.closed = true;
  if (at) $$tracer()?.emit({ kind: 'close', actor: at.actor, channel: id, line: at.line });
  // What made the channel stops with it, as signal() does (signals.js).
  state.onClose?.();
  $$pump(id);
}

// What a closed channel gives: a value of its own for each receiver, if it is an array or a queue.
export function $$zero({ zero }) {
  return Array.isArray(zero) ? [] : zero instanceof $$deque ? new $$deque() : zero;
}

export async function* $$range(channel, line) {
  while (true) {
    const [value, ok] = await $$receive(channel, true, null, line);

    if (!ok) return;
    yield value;
  }
}

export function $$wait(id, queue, entry) {
  const state = $$registry().states.get(id);

  if (!state) return entry.fail?.($$stopped());
  state[queue].push(entry);
  $$pump(id);
  // A traced operation that is still in the queue waits.
  if (entry.at && !entry.at.passed) {
    const op = queue === 'senders' ? 'send' : 'receive';

    $$tracer()?.emit({ kind: 'wait', actor: entry.at.actor, op, channel: id, line: entry.at.line });
  }
}

// The operations of other threads on the channels of this one.
export function $$message(from, data) {
  const answer = (value) => $$post(from, { answer: data.ask, value });
  const fail = (error) => $$post(from, { answer: data.ask, error });
  const select = { key: from, sid: data.sid };

  switch (data.op) {
    case 'send':
      return $$wait(data.channel, 'senders', {
        from,
        value: data.value,
        done: answer,
        fail,
        at: data.at,
      });

    case 'receive':
      return $$wait(data.channel, 'receivers', { from, done: answer, fail, at: data.at });

    case 'close':
      try {
        $$closeHere(data.channel, data.at);

        return answer();
      } catch (error) {
        return fail(error);
      }

    case 'try':
      try {
        return answer($$try(data.channel, data.send, data.value));
      } catch (error) {
        return fail(error);
      }

    case 'select':
      return $$select(data.cases, data.hasDefault).then(answer, fail);

    case 'wait':
      return $$wait(data.channel, data.send ? 'senders' : 'receivers', {
        select,
        case: data.case,
        value: data.value,
      });

    case 'cancel':
      return $$unwait(select, data.channels);

    case 'lock':
      return answer($$lock(data.sid));

    case 'unlock':
      return $$unlock(data.sid);

    case 'commit':
      return $$commit(data.sid, data.case, data.result, data.error);
  }
}

// Matches what waits in a channel: a receiver with a value of the buffer, a sender or the zero value
// after close; a sender with room in the buffer. A case of a select goes on only if its select
// has not gone on with another case, which the thread of the select tells.
export function $$pump(id) {
  const state = $$registry().states.get(id);

  while (state && !state.busy) {
    const receiver = state.receivers.at(0);
    const sender = state.senders.at(0);

    if (receiver && (state.buffer.length > 0 || state.closed)) {
      if (!$$pair(id, state, receiver, null)) return;
    } else if (receiver && sender) {
      if (!$$pair(id, state, receiver, sender)) return;
    } else if (sender && (state.closed || state.buffer.length < state.size)) {
      if (!$$pair(id, state, null, sender)) return;
    } else {
      return;
    }
  }
}

// Whether the pump can go on at once: a pair whose selects are all in this thread is decided here.
export function $$pair(id, state, receiver, sender) {
  const entries = [receiver, sender].filter((entry) => entry !== null);
  const key = $$registry().key;

  if (entries.some((entry) => entry.select && entry.select.key !== key)) {
    $$pairLater(id, state, receiver, sender);

    return false;
  }

  const locks = entries.map((entry) => (entry.select ? $$lock(entry.select.sid) : 'locked'));

  if (locks.every((lock) => lock === 'locked')) {
    $$complete(state, receiver, sender, id);

    return true;
  }

  entries.forEach((entry, i) => locks[i] === 'locked' && $$unlockAt(entry.select));

  return $$settle(id, state, entries, locks);
}

// A pair with a select of another thread: the channel waits for the answers of that thread.
export async function $$pairLater(id, state, receiver, sender) {
  state.busy = true;

  const entries = [receiver, sender].filter((entry) => entry !== null);
  const locks = [];

  for (const { select } of entries) {
    const lock = !select
      ? 'locked'
      : select.key === $$registry().key
        ? $$lock(select.sid)
        : await $$ask(select.key, { op: 'lock', sid: select.sid }).catch(() => 'done');

    locks.push(lock);
    if (lock !== 'locked') break;
  }

  state.busy = false;
  if (locks.length === entries.length && locks.every((lock) => lock === 'locked')) {
    $$complete(state, receiver, sender, id);
  } else {
    entries.forEach((entry, i) => locks[i] === 'locked' && $$unlockAt(entry.select));
    if (!$$settle(id, state, entries, locks)) return;
  }

  $$pump(id);
}

// After a pair that could not go on: a select that has gone on leaves the queue; one that another
// channel is deciding is tried again a little later.
export function $$settle(id, state, entries, locks) {
  entries.forEach((entry, i) => {
    if (locks[i] === 'done') $$remove(state, entry);
  });
  if (locks.includes('done')) return true;
  setTimeout(() => $$pump(id), 1 + Math.random() * 4);

  return false;
}

export function $$remove(state, entry) {
  state.receivers.$$delete(entry);
  state.senders.$$delete(entry);
}

// Takes the pair off the queues and passes the value.
export function $$complete(state, receiver, sender, id) {
  if (receiver) state.receivers.$$delete(receiver);
  if (sender) state.senders.$$delete(sender);
  if (receiver?.at) receiver.at.passed = true;
  if (sender?.at) sender.at.passed = true;
  if (receiver) {
    const result =
      state.buffer.length > 0
        ? [state.buffer.shift(), true]
        : sender
          ? [sender.value, true]
          : [$$zero(state), false];

    if (result[1]) $$passed(id, receiver, sender, result[0]);
    $$finish(receiver, result);
    if (sender) $$finish(sender);
  } else if (state.closed) {
    $$finish(sender, undefined, new Error('send on a closed channel'));
  } else {
    state.buffer.push(sender.value);
    $$passed(id, null, sender, sender.value);
    $$finish(sender);
  }
}

// Tells the listener of a value that went through a channel (trace.js): from the sender or the
// buffer to the receiver or the buffer. Who came to the channel later made the move.
export function $$passed(id, receiver, sender, value) {
  const places = [receiver?.at, sender?.at].filter(Boolean);

  if (places.length === 0) return;

  const mover = places.reduce((a, b) => (a.order > b.order ? a : b));

  $$tracer()?.emit({
    kind: 'pass',
    actor: mover.actor,
    channel: id,
    from: sender?.at?.actor ?? null,
    to: receiver?.at?.actor ?? null,
    value,
    line: mover.line,
  });
}

export function $$finish(entry, result, error) {
  const { select } = entry;

  if (!select) return error ? entry.fail(error) : entry.done(result);
  if (select.key === $$registry().key) return $$commit(select.sid, entry.case, result, error);
  $$post(select.key, { op: 'commit', sid: select.sid, case: entry.case, result, error });
}

export function $$unlockAt(select) {
  if (!select) return;
  if (select.key === $$registry().key) $$unlock(select.sid);
  else $$post(select.key, { op: 'unlock', sid: select.sid });
}
