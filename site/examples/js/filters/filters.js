// The same filters in JavaScript: the page starts the workers, splits the pixels among them,
// sends each its part and puts the answers together

import { FILTERS, HEIGHT, WIDTH, filteredAt } from './filters-pixels.js';

// A worker for each processor; a bundler finds its file by this new URL
const workers = Array.from(
  { length: navigator.hardwareConcurrency },
  () => new Worker(new URL('./filters.worker.js', import.meta.url), { type: 'module' }),
);
let calls = 0;

function applyOnOne(src, filter) {
  const out = new Uint8ClampedArray(src.length);

  for (let i = 0; i < out.length; i++) out[i] = filteredAt(src, i, filter);

  return out;
}

// The id tells apart the answers of two calls at once. An exception in a worker leaves
// the Promise waiting: errors need messages of their own
function applyOnAll(src, filter) {
  const id = calls++;
  const out = new Uint8ClampedArray(src.length);
  const size = Math.ceil(src.length / 4 / workers.length) * 4;
  const parts = workers.map(
    (worker, n) =>
      new Promise((resolve) => {
        const from = n * size;

        function answer({ data }) {
          if (data.id !== id) return;
          worker.removeEventListener('message', answer);
          out.set(data.part, from);
          resolve();
        }

        worker.addEventListener('message', answer);
        worker.postMessage({ id, src, filter, from, to: Math.min(from + size, src.length) });
      }),
  );

  return Promise.all(parts).then(() => out);
}

// A picture to work on, drawn by a canvas: a sky, circles and big letters
function picture() {
  const context = Object.assign(document.createElement('canvas'), {
    width: WIDTH,
    height: HEIGHT,
  }).getContext('2d');
  const sky = context.createLinearGradient(0, 0, WIDTH, HEIGHT);

  sky.addColorStop(0, '#1d2b64');
  sky.addColorStop(1, '#f8a35b');
  context.fillStyle = sky;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 40; i++) {
    context.fillStyle = `hsl(${i * 37} 80% 60% / 0.7)`;
    context.beginPath();
    context.arc((i * 211) % WIDTH, (i * 137) % HEIGHT, 30 + (i % 5) * 25, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = '#fff';
  context.font = 'bold 300px sans-serif';
  context.fillText('Rook', 380, 560);

  return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

const source = picture();
let filter = FILTERS[0];
let turn = 0;
const canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
const choices = document.createElement('p');
const buttons = document.createElement('p');
const report = document.createElement('p');
const button = (label, onClick) =>
  Object.assign(document.createElement('button'), { textContent: label, onclick: onClick });
const actions = [
  button('One thread', () => apply(false)),
  button('Every processor', () => apply(true)),
  button('Original', () => draw(source)),
];
let status = 'Choose a filter and where to apply it';

canvas.style.width = '100%';
for (const each of FILTERS) {
  const input = Object.assign(document.createElement('input'), {
    type: 'radio',
    name: 'filter',
    checked: each === filter,
    onchange: () => (filter = each),
  });
  const label = document.createElement('label');

  label.append(input, ` ${each.name}  `);
  choices.append(label);
}

buttons.append(...actions.flatMap((action) => [action, ' ']));
document.body.append(canvas, choices, buttons, report);
draw(source);
show();
// Turns while the page is free: on one thread it stops until the filter is done
setInterval(() => {
  turn = (turn + 1) % 8;
  show();
}, 100);

function show() {
  report.textContent = `${'◐◓◑◒◐◓◑◒'[turn]} ${status}`;
}

function draw(pixels) {
  const image = new ImageData(WIDTH, HEIGHT);

  image.data.set(pixels);
  canvas.getContext('2d').putImageData(image, 0, 0);
}

async function apply(all) {
  for (const action of actions) action.disabled = true;
  status = 'Working…';
  show();
  // Lets the page show it before one thread is busy
  await new Promise((resolve) => setTimeout(resolve, 50));

  const start = performance.now();
  const out = all ? await applyOnAll(source, filter) : applyOnOne(source, filter);
  const ms = Math.round(performance.now() - start);
  const where = all ? `on ${navigator.hardwareConcurrency} processors` : 'on one thread';

  draw(out);
  status = `${filter.name}: ${ms} ms ${where}`;
  show();
  for (const action of actions) action.disabled = false;
}
