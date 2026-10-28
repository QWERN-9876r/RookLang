// Те же фильтры на JavaScript: страница запускает воркеры, делит между ними пиксели,
// отправляет каждому его часть и собирает ответы

import { FILTERS, HEIGHT, WIDTH, filteredAt } from './filters-pixels.js';

// По воркеру на процессор; сборщик находит его файл по этому new URL
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

// id различает ответы двух вызовов сразу. Исключение в воркере оставляет Promise
// ждать: для ошибок нужны свои сообщения
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

// Картинка для работы, нарисованная на canvas: небо, круги и большие буквы
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
  button('Один поток', () => apply(false)),
  button('Все процессоры', () => apply(true)),
  button('Оригинал', () => draw(source)),
];
let status = 'Выберите фильтр и где его применить';

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
// Крутится, пока страница свободна: в одном потоке замирает, пока фильтр не закончит
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
  status = 'Работаю…';
  show();
  // Страница успевает это показать, пока поток не занят
  await new Promise((resolve) => setTimeout(resolve, 50));

  const start = performance.now();
  const out = all ? await applyOnAll(source, filter) : applyOnOne(source, filter);
  const ms = Math.round(performance.now() - start);
  const where = all ? `на процессорах: ${navigator.hardwareConcurrency}` : 'в одном потоке';

  draw(out);
  status = `${filter.name}: ${ms} мс ${where}`;
  show();
  for (const action of actions) action.disabled = false;
}
