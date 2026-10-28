// The worker, a file of its own: it gets a part in a message and sends back the result,
// moving its buffer instead of copying it

import { filteredAt } from './filters-pixels.js';

self.onmessage = ({ data: { id, src, filter, from, to } }) => {
  const part = new Uint8ClampedArray(to - from);

  for (let i = from; i < to; i++) part[i - from] = filteredAt(src, i, filter);
  self.postMessage({ id, part }, [part.buffer]);
};
