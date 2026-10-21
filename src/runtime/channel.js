// `Channel`: what Rook code and the code compiled from it do with channels, by name. The functions
// themselves are in chan.js, select.js, streams.js and timers.js.

import { $$chan, $$close, $$range, $$receive, $$send } from './chan.js';
import { $$select, $$try } from './select.js';
import { $$fromStream, $$stream } from './streams.js';
import { $$after, $$tick } from './timers.js';

export const $$Channel = Object.freeze({
  // The zero value of channel types: closed, and the same in every thread (threads.js).
  EMPTY: Object.freeze({ $$chan: 'empty', size: 0, zero: null }),
  make: $$chan,
  send: $$send,
  receive: $$receive,
  close: $$close,
  range: $$range,
  select: $$select,
  // [] for a send and [value, ok] for a receive that goes on at once, else null.
  try: (channel, send, value) => $$try(channel.$$chan, send, value),
  fromStream: $$fromStream,
  stream: $$stream,
  after: $$after,
  tick: $$tick,
});
