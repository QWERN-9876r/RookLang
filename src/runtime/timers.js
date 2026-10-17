// Channels of time, as in Go: `after(ms)` and `tick(ms)`.

import { $$chan, $$send } from './chan.js';
import { $$try } from './select.js';
import { $$registry } from './threads.js';

// `after(ms)`: a channel that gets the time once, after `ms`. `tick(ms)`: one that gets it every
// `ms` until it is closed; a tick that finds the last one still there is dropped, as in Go.
export function $$after(ms) {
  const channel = $$chan(1, 0);

  setTimeout(() => $$send(channel, Date.now()), ms);

  return channel;
}

export function $$tick(ms) {
  const channel = $$chan(1, 0);
  const timer = setInterval(() => {
    const state = $$registry().states.get(channel.$$chan);

    if (!state || state.closed) clearInterval(timer);
    else $$try(channel.$$chan, true, Date.now());
  }, ms);

  return channel;
}
