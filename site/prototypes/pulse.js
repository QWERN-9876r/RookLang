/* global document, matchMedia */

const stateCount = document.querySelector('#state-count');
const codeCount = document.querySelector('#code-count');
const graphCount = document.querySelector('#graph-count');
const graphDouble = document.querySelector('#graph-double');
const buttonValue = document.querySelector('#button-value');
const paragraphValue = document.querySelector('#paragraph-value');
const graph = document.querySelector('#graph');
const status = document.querySelector('#status');
const changedNodes = [
  document.querySelector('#button-node'),
  document.querySelector('#paragraph-node'),
];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let count = 0;
let language = 'ru';

function setLanguage(next) {
  language = next;
  document.documentElement.lang = language;
  document.querySelector('#language').textContent = language === 'ru' ? 'EN' : 'RU';
  for (const element of document.querySelectorAll('[data-en][data-ru]')) {
    element.innerHTML = element.dataset[language];
  }

  status.textContent =
    count === 0
      ? language === 'ru'
        ? 'Готово · count = 0'
        : 'Ready · count = 0'
      : language === 'ru'
        ? `count: ${count} · обновлены 2 узла`
        : `count: ${count} · 2 nodes updated`;
}

function render() {
  stateCount.textContent = `${count}`;
  codeCount.textContent = `${count}`;
  graphCount.textContent = `${count}`;
  graphDouble.textContent = `${count * 2}`;
  buttonValue.textContent = `${count}`;
  paragraphValue.textContent = `${count * 2}`;
}

function pulse() {
  graph.classList.remove('running');
  for (const node of changedNodes) {
    node.classList.remove('changed');
  }

  void graph.offsetWidth;
  graph.classList.add('running');
  for (const node of changedNodes) {
    node.classList.add('changed');
  }
}

function change() {
  const previous = count;

  count += 1;
  render();
  if (!motion.matches) {
    pulse();
  }

  status.textContent =
    language === 'ru'
      ? `count: ${previous} → ${count} · обновлены 2 узла`
      : `count: ${previous} → ${count} · 2 nodes updated`;
}

function reset() {
  count = 0;
  render();
  graph.classList.remove('running');
  for (const node of changedNodes) {
    node.classList.remove('changed');
  }

  status.textContent = language === 'ru' ? 'Готово · count = 0' : 'Ready · count = 0';
}

document.querySelector('#run').addEventListener('click', change);
document.querySelector('#reset').addEventListener('click', reset);
document.querySelector('#language').addEventListener('click', () => {
  setLanguage(language === 'ru' ? 'en' : 'ru');
});
