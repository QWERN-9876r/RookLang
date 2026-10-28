// Воркер, отдельный файл: получает часть в сообщении и отправляет результат обратно,
// перенося его буфер, а не копируя

import { filteredAt } from './filters-pixels.js';

self.onmessage = ({ data: { id, src, filter, from, to } }) => {
  const part = new Uint8ClampedArray(to - from);

  for (let i = from; i < to; i++) part[i - from] = filteredAt(src, i, filter);
  self.postMessage({ id, part }, [part.buffer]);
};
