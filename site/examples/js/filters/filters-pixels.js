// What both threads need, in a module of its own: the worker imports it, and so does the page

export const WIDTH = 1600;
export const HEIGHT = 900;

const box = (size) => Array.from({ length: size * size }, () => 1 / (size * size));

function diagonal(size) {
  const weights = box(size).map(() => 0);

  for (let i = 0; i < size; i++) weights[i * (size + 1)] = 1 / size;

  return weights;
}

export const FILTERS = [
  { name: 'Blur', size: 13, weights: box(13) },
  { name: 'Motion', size: 15, weights: diagonal(15) },
  { name: 'Sharpen', size: 3, weights: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
  { name: 'Edges', size: 3, weights: [-1, -1, -1, -1, 8, -1, -1, -1, -1] },
  { name: 'Emboss', size: 3, weights: [-2, -1, 0, -1, 1, 1, 0, 1, 2] },
];

// A channel of one pixel through the filter; past the edges the nearest pixel stands in
export function filteredAt(src, i, filter) {
  const channel = i % 4;

  if (channel === 3) return 255;

  const x = Math.floor(i / 4) % WIDTH;
  const y = Math.floor(i / 4 / WIDTH);
  const half = (filter.size - 1) / 2;
  let sum = 0;

  for (let dy = 0; dy < filter.size; dy++) {
    const yy = Math.min(Math.max(y + dy - half, 0), HEIGHT - 1);

    for (let dx = 0; dx < filter.size; dx++) {
      const xx = Math.min(Math.max(x + dx - half, 0), WIDTH - 1);

      sum += src[(yy * WIDTH + xx) * 4 + channel] * filter.weights[dy * filter.size + dx];
    }
  }

  return sum;
}
