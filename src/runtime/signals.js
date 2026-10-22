// Signals of the process and AbortSignal as channels: `signal(...names)`, `done(abortSignal)` and
// `abortSignal(ch)`, as signal.Notify and the Done() of a context are in Go.

import { $$chan, $$closeHere, $$receive } from './chan.js';
import { $$try } from './select.js';
import { $$registry } from './threads.js';

// `signal("SIGINT", "SIGTERM")`: a channel that gets the name of each signal that comes. While it
// listens, the signals do not end the process, and it keeps the program running, as a tick does;
// `close(ch)` stops it, and the signals do what they did before. A signal that finds the last one
// not received yet is dropped. Only the main thread of Node gets the signals of the process.
export function $$signal(...names) {
  // Node's own, which a browser does not have.
  const { process } = globalThis;

  if (process === undefined) throw new Error('signal() needs Node: a browser has no signals');

  const channel = $$chan(1, '');
  const listener = (name) => $$try(channel.$$chan, true, name);
  // A listener of a signal does not keep the program running, and a timer that never fires does.
  const timer = setInterval(() => {}, 2 ** 31 - 1);

  for (const name of names) process.on(name, listener);
  $$registry().states.get(channel.$$chan).onClose = () => {
    clearInterval(timer);
    for (const name of names) process.off(name, listener);
  };

  return channel;
}

// `done(signal)`: a channel that gets the reason of an AbortSignal when it aborts, and is closed
// then, so that `case <-done(request.signal):` goes on once the request is cancelled.
export function $$done(signal) {
  const channel = $$chan(1, null);
  const abort = () => {
    $$try(channel.$$chan, true, signal.reason);
    $$closeHere(channel.$$chan);
  };

  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });

  return channel;
}

// `abortSignal(ch)`: an AbortSignal that aborts when the channel gets a value, with the value as
// its reason, or is closed, for `fetch(url, { signal: abortSignal(stop) })`. It receives that one
// value, as any receiver of the channel would.
export function $$abortSignal(channel) {
  const controller = new AbortController();

  $$receive(channel, true).then(
    ([value, ok]) => controller.abort(ok ? value : undefined),
    (error) => controller.abort(error),
  );

  return controller.signal;
}
