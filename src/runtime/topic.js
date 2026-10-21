// Topics: values that go to the other tabs of a site, and to its workers, over a BroadcastChannel
// of their name. A topic is data, `{ $$topic: name, zero }`, so it goes to a worker as its name,
// and there it is a topic of its own. Each topic listens from its first receive on, into a channel
// without a limit, so that `<-t`, `for v in t` and `select` are those of channels. `Topic` has
// what Rook code and the code compiled from it do with topics, by name.

import { $$chan, $$closeHere, $$send } from './chan.js';
import { $$Channel } from './channel.js';
import { $$walk } from './threads.js';

export const $$Topic = Object.freeze({
  // The zero value of topic types: it has no name, it is closed, and what is sent to it goes
  // nowhere.
  EMPTY: Object.freeze({ $$topic: null, zero: null }),
  make: $$topic,
  publish: $$publish,
  listen: $$listen,
  close: $$closeTopic,
});

// What the modules of a thread share: one BroadcastChannel for each name, so that the topics of
// this thread do not hear what it sends, as one BroadcastChannel does not hear itself; the channel
// that each topic listens into, and the topics that are closed.
function $$topics() {
  return (globalThis[Symbol.for('rook.topics')] ??= {
    names: new Map(),
    channels: new WeakMap(),
    closed: new WeakSet(),
  });
}

export function $$topic(name, zero) {
  return { $$topic: name, zero };
}

// `t <- v`: the value goes to the other threads that listen and is not kept here, so nothing waits.
export function $$publish(topic, value) {
  if (topic.$$topic === null) return;
  if ($$topics().closed.has(topic)) throw new Error('send on a closed topic');
  $$named(topic.$$topic).channel.postMessage(value);
}

// The channel that a topic listens into, from the first receive on; a closed topic gives a closed
// one, and Topic.EMPTY gives Channel.EMPTY. A null topic turns off its case of `select`, as a null
// channel does.
export function $$listen(topic) {
  if (topic === null) return null;
  if (topic.$$topic === null) return $$Channel.EMPTY;

  const { channels, closed } = $$topics();
  let channel = channels.get(topic);

  if (channel) return channel;
  channel = $$chan(Infinity, topic.zero);
  channels.set(topic, channel);
  if (closed.has(topic)) $$closeHere(channel.$$chan);
  else $$listening(topic, true);

  return channel;
}

// `close(t)`: the topic stops listening and sending; what it has received can still be received.
export function $$closeTopic(topic) {
  const { channels, closed } = $$topics();

  if (topic.$$topic === null) return;
  if (closed.has(topic)) throw new Error('close of a closed topic');
  closed.add(topic);

  const channel = channels.get(topic);

  if (!channel) return;
  $$closeHere(channel.$$chan);
  $$listening(topic, false);
}

// The BroadcastChannel of a name and the topics of this thread that listen to it, each of which
// gets a copy of its own.
function $$named(name) {
  const { names, channels } = $$topics();
  const found = names.get(name);

  if (found) return found;

  const entry = { channel: new BroadcastChannel(name), listening: new Set() };

  entry.channel.onmessage = ({ data }) => {
    let first = true;

    for (const topic of entry.listening) {
      const value = first ? data : structuredClone(data);

      first = false;
      $$walk(value);
      $$send(channels.get(topic), value);
    }
  };

  names.set(name, entry);
  $$keepAlive(entry);

  return entry;
}

function $$listening(topic, on) {
  const entry = $$named(topic.$$topic);

  if (on) entry.listening.add(topic);
  else entry.listening.delete(topic);
  $$keepAlive(entry);
}

// In Node, a BroadcastChannel keeps the program running only while a topic listens to it, as a
// `tick` does until it is closed.
function $$keepAlive({ channel, listening }) {
  if (listening.size > 0) channel.ref?.();
  else channel.unref?.();
}
