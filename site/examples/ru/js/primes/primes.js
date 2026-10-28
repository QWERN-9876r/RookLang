// Та же работа на JavaScript: страница запускает воркер из отдельного
// файла, различает его сообщения по типу, останавливает его через
// terminate() и для следующего запуска создаёт новый, а числа
// перерисовывает вручную

const LIMIT = 50_000_000;

const style = document.createElement('style');

style.textContent = `
  .job { display: grid; gap: 16px; max-width: 460px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stat { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: #ffffff0d; }
  .stat b { font-size: 1.3em; font-variant-numeric: tabular-nums; }
  .stat span { color: #ffffff80; font-size: 0.8em; }
  .track { height: 8px; border-radius: 999px; background: #ffffff14; overflow: hidden; }
  .fill { width: 0; height: 100%; background: #f5a524; transition: width 0.2s; }
  .buttons { display: flex; gap: 8px; }
  .job button {
    padding: 8px 16px; border: 1px solid #ffffff2e; border-radius: 8px;
    background: #ffffff0a; color: inherit; font: inherit; cursor: pointer;
  }
  .job button:disabled { opacity: 0.4; cursor: default; }
  .job .start { border-color: #f5a524; background: #f5a524; color: #000; }
  .report { margin: 0; color: #ffffffb3; }
  .job .free { justify-self: start; border-style: dashed; color: #ffffffb3; }
`;

function element(tag, className, text = '') {
  const node = document.createElement(tag);

  node.className = className;
  node.textContent = text;

  return node;
}

function stat(label) {
  const box = element('div', 'stat');
  const value = element('b', '');

  box.append(value, element('span', '', label));

  return [box, value];
}

const [foundBox, foundValue] = stat('простых найдено');
const [percentBox, percentValue] = stat('проверено');
const [secondsBox, secondsValue] = stat('прошло');
const stats = element('div', 'stats');
const track = element('div', 'track');
const fill = element('div', 'fill');
const buttons = element('div', 'buttons');
const start = element('button', 'start', 'Старт');
const stop = element('button', '', 'Отмена');
const report = element('p', 'report', 'Посчитаем простые числа до 50 миллионов');
const free = element('button', 'free');
const root = element('div', 'job');

stats.append(foundBox, percentBox, secondsBox);
track.append(fill);
buttons.append(start, stop);
root.append(stats, track, buttons, report, free);
document.body.append(style, root);

let worker = null;
let checked = 0;
let found = 0;
let seconds = 0;
let clicks = 0;

// То, за чем разметка компонента следит сама
function render() {
  const percent = Math.round((checked / LIMIT) * 100);

  foundValue.textContent = found.toLocaleString();
  percentValue.textContent = `${percent}%`;
  secondsValue.textContent = `${seconds.toFixed(1)} с`;
  fill.style.width = `${percent}%`;
  start.disabled = worker !== null;
  stop.disabled = worker === null;
  free.textContent = `Страница свободна, нажмите: ${clicks}`;
}

function finish(text) {
  worker.terminate();
  worker = null;
  report.textContent = text;
  render();
}

start.addEventListener('click', () => {
  const begin = performance.now();

  // Остановленный воркер нельзя запустить снова: каждый запуск создаёт свой
  worker = new Worker(new URL('./primes.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    seconds = (performance.now() - begin) / 1000;
    if (data.type === 'done') {
      finish(`Готово: ${data.found.toLocaleString()} простых`);

      return;
    }

    checked = data.checked;
    found = data.found;
    render();
  };

  worker.postMessage({ limit: LIMIT });
  checked = 0;
  found = 0;
  report.textContent = 'Считаю на другом процессоре…';
  render();
});

stop.addEventListener('click', () => {
  finish(`Отменено на ${Math.round((checked / LIMIT) * 100)}%`);
});

free.addEventListener('click', () => {
  clicks++;
  render();
});

render();
