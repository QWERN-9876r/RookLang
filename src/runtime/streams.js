// Streams and channels: `chan(stream, size)` and `stream(ch)`.

import { $$chan, $$closeHere, $$receive, $$send } from './chan.js';
import { $$try } from './select.js';
import { $$registry } from './threads.js';

// `chan(stream, size)`: a channel of the chunks of a stream and one of its error. The next chunk is
// read only when the last one is in the channel, so a full channel stops the stream; closing
// the channel cancels it.
export function $$fromStream(stream, size, zero) {
  const channel = $$chan(size, zero);
  const failed = $$chan(1, null);
  const id = channel.$$chan;

  (async () => {
    const reader = stream?.getReader();
    let failure = null;

    while (reader) {
      let chunk;

      try {
        chunk = await reader.read();
      } catch (error) {
        failure = error;
        break;
      }

      if (chunk.done) break;
      try {
        await $$send(channel, chunk.value);
      } catch {
        reader.cancel().catch(() => {});
        break;
      }
    }

    // The pump holds both channels, so they are not forgotten; the one of the error has room.
    if (!$$registry().states.get(id).closed) $$closeHere(id);
    $$try(failed.$$chan, true, failure);
    $$closeHere(failed.$$chan);
  })();

  return [channel, failed];
}

// `stream(ch)`: a stream that reads one value of the channel for each read, so the room of the
// channel is all it buffers, and ends when the channel is closed.
export function $$stream(channel) {
  return new ReadableStream(
    {
      async pull(controller) {
        const [value, ok] = await $$receive(channel, true);

        if (ok) controller.enqueue(value);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}
