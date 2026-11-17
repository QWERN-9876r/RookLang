/* global URLSearchParams, console, document, localStorage, location */

const sections = [
  { id: 'intro', en: 'What is Rook', ru: 'Что такое Rook', groupEn: 'Language', groupRu: 'Язык' },
  {
    id: 'variables',
    en: 'Variables and types',
    ru: 'Переменные и типы',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  {
    id: 'bigint',
    en: 'bigint and typed arrays',
    ru: 'bigint и типизированные массивы',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  { id: 'queues', en: 'Queues', ru: 'Очереди', groupEn: 'Language', groupRu: 'Язык' },
  {
    id: 'null',
    en: 'null, unions and narrowing',
    ru: 'null, union и сужение',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  { id: 'functions', en: 'Functions', ru: 'Функции', groupEn: 'Language', groupRu: 'Язык' },
  {
    id: 'errors',
    en: 'Errors and defer',
    ru: 'Ошибки и defer',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  {
    id: 'control',
    en: 'Conditions and loops',
    ru: 'Условия и циклы',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  { id: 'iterators', en: 'Iterators', ru: 'Итераторы', groupEn: 'Language', groupRu: 'Язык' },
  {
    id: 'classes',
    en: 'Classes and interfaces',
    ru: 'Классы и интерфейсы',
    groupEn: 'Language',
    groupRu: 'Язык',
  },
  { id: 'generics', en: 'Generics', ru: 'Дженерики', groupEn: 'Language', groupRu: 'Язык' },
  { id: 'make', en: 'make', ru: 'make', groupEn: 'Language', groupRu: 'Язык' },
  { id: 'modules', en: 'Modules', ru: 'Модули', groupEn: 'Language', groupRu: 'Язык' },
  {
    id: 'async',
    en: 'Async functions',
    ru: 'Асинхронные функции',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'goroutines',
    en: 'Goroutines',
    ru: 'Горутины',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'channels',
    en: 'Channels',
    ru: 'Каналы',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'select',
    en: 'select',
    ru: 'select',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'streams',
    en: 'Streams',
    ru: 'Потоки',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'topics',
    en: 'Topics',
    ru: 'Топики',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  {
    id: 'channel-objects',
    en: 'Channel and Topic',
    ru: 'Channel и Topic',
    groupEn: 'Concurrency',
    groupRu: 'Горутины и каналы',
  },
  { id: 'try', en: 'try', ru: 'try', groupEn: 'Server', groupRu: 'Сервер' },
  { id: 'decode', en: 'decode', ru: 'decode', groupEn: 'Server', groupRu: 'Сервер' },
  {
    id: 'async-iterables',
    en: 'for over streams',
    ru: 'for по потокам',
    groupEn: 'Server',
    groupRu: 'Сервер',
  },
  {
    id: 'signals',
    en: 'Signals and cancellation',
    ru: 'Сигналы и отмена',
    groupEn: 'Server',
    groupRu: 'Сервер',
  },
  {
    id: 'markup',
    en: 'Markup',
    ru: 'Разметка',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'components',
    en: 'Components',
    ru: 'Компоненты',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'state',
    en: 'State',
    ru: 'Состояние',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'mount',
    en: 'Mounting',
    ru: 'Монтирование',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'ref',
    en: 'Refs',
    ru: 'Ссылки на элементы',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'styles',
    en: 'Styles',
    ru: 'Стили',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'web-components',
    en: 'Web components',
    ru: 'Веб-компоненты',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'decorators',
    en: 'Decorators',
    ru: 'Декораторы',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  {
    id: 'server-components',
    en: 'Components on the server',
    ru: 'Компоненты на сервере',
    groupEn: 'Markup & components',
    groupRu: 'Разметка и компоненты',
  },
  { id: 'tools', en: 'Tools', ru: 'Инструменты', groupEn: 'More', groupRu: 'Ещё' },
  {
    id: 'adoption',
    en: 'Rook in an existing project',
    ru: 'Rook в существующем проекте',
    groupEn: 'More',
    groupRu: 'Ещё',
  },
];

const PROGRESS_KEY = 'rook.stage7.progress';
const board = document.querySelector('#board');
const progressValue = document.querySelector('#progress-value');
const capacityCode = document.querySelector('#capacity-code');
const taskStatus = document.querySelector('#task-status');
const traceState = document.querySelector('#trace-state');
const trace = document.querySelector('#trace');
let language = 'ru';
let capacity = 0;

function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');

    return new Set(
      Array.isArray(saved)
        ? saved.filter((id) => sections.some((section) => section.id === id))
        : [],
    );
  } catch (error) {
    console.warn('could not read prototype progress:', error);

    return new Set();
  }
}

let visited = readProgress();
const requestedSection = new URLSearchParams(location.search).get('section');
let current = sections.some((section) => section.id === requestedSection)
  ? requestedSection
  : [...visited].at(-1) || 'intro';

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...visited]));
  } catch (error) {
    console.warn('could not save prototype progress:', error);
  }
}

function renderMap() {
  board.replaceChildren();
  board.setAttribute('aria-label', language === 'ru' ? 'Разделы руководства' : 'Guide sections');
  for (const [index, section] of sections.entries()) {
    const group = language === 'ru' ? section.groupRu : section.groupEn;
    const link = document.createElement('a');

    link.className = 'square';
    link.href = `../docs/${section.id}/`;
    link.dataset.section = section.id;
    link.setAttribute('aria-label', `${index + 1}. ${section[language]} · ${group}`);
    link.innerHTML = `<span class="number">${String(index + 1).padStart(2, '0')}</span><span class="name"></span><span class="group"></span>`;
    link.querySelector('.name').textContent = section[language];
    link.querySelector('.group').textContent = group;
    link.classList.toggle('visited', visited.has(section.id));
    link.classList.toggle('current', section.id === current);
    if (section.id === current) {
      const marker = document.createElement('span');

      marker.className = 'marker';
      marker.textContent = '♜';
      marker.setAttribute('aria-hidden', 'true');
      link.append(marker);
      link.setAttribute('aria-current', 'location');
    }

    link.addEventListener('click', () => {
      visited.add(section.id);
      saveProgress();
    });
    board.append(link);
  }

  progressValue.textContent = `${visited.size} / ${sections.length}`;
}

function setLanguage(next) {
  language = next;
  document.documentElement.lang = language;
  document.querySelector('#language').textContent = language === 'ru' ? 'EN' : 'RU';
  document
    .querySelector('#language')
    .setAttribute('aria-label', language === 'ru' ? 'Switch to English' : 'Переключить на русский');
  for (const element of document.querySelectorAll('[data-en][data-ru]')) {
    element.textContent = element.dataset[language];
  }

  document
    .querySelector('.legend')
    .setAttribute('aria-label', language === 'ru' ? 'Обозначения карты' : 'Map legend');
  document
    .querySelector('.capacity')
    .setAttribute(
      'aria-label',
      language === 'ru' ? 'Размер буфера канала' : 'Channel buffer capacity',
    );
  document.querySelector('footer a').href = language === 'ru' ? '../PLAN.ru.md' : '../PLAN.md';
  renderMap();
  runTask();
}

function updateTaskStatus(success = false) {
  taskStatus.classList.toggle('success', success);
  taskStatus.textContent = success
    ? language === 'ru'
      ? 'Пат снят: сообщение прошло по каналу. Задача решена.'
      : 'Stalemate removed: the value passed through. Puzzle solved.'
    : language === 'ru'
      ? 'Выберите буфер и запустите программу.'
      : 'Choose a buffer and run the program.';
}

function showEvents(events, success) {
  trace.replaceChildren();
  for (const event of events) {
    const item = document.createElement('li');

    item.className = event.kind;
    item.textContent = event.text[language];
    trace.append(item);
  }

  traceState.textContent = success ? (language === 'ru' ? 'ХОДЫ ЕСТЬ' : 'MOVES AVAILABLE') : 'ПАТ';
  traceState.classList.toggle('success', success);
}

function runTask() {
  const events =
    capacity > 0
      ? [
          {
            kind: 'pass',
            from: 'main',
            to: null,
            text: {
              ru: `jobs ← 7 · значение попало в буфер ${capacity}`,
              en: `jobs ← 7 · value enters buffer ${capacity}`,
            },
          },
          {
            kind: 'pass',
            from: null,
            to: 'main',
            text: { ru: '←jobs · получено значение 7', en: '←jobs · received value 7' },
          },
          { kind: 'end', text: { ru: 'Программа завершилась', en: 'Program finished' } },
        ]
      : [
          {
            kind: 'wait',
            op: 'send',
            text: {
              ru: 'jobs ← 7 · буфера нет, отправка ждёт получателя',
              en: 'jobs ← 7 · unbuffered send waits for a receiver',
            },
          },
          { kind: 'stalemate', text: { ru: 'main ждёт · пат', en: 'main is waiting · stalemate' } },
        ];
  const success =
    events.some((event) => event.kind === 'pass' && event.to === null) &&
    events.some((event) => event.kind === 'pass' && event.from === null) &&
    !events.some((event) => event.kind === 'stalemate');

  showEvents(events, success);
  if (success) {
    updateTaskStatus(true);
  } else {
    updateTaskStatus();
  }
}

document.querySelector('#language').addEventListener('click', () => {
  setLanguage(language === 'ru' ? 'en' : 'ru');
});

document.querySelector('#clear-progress').addEventListener('click', () => {
  visited = new Set();
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch (error) {
    console.warn('could not clear prototype progress:', error);
  }

  renderMap();
});

for (const button of document.querySelectorAll('[data-capacity]')) {
  button.addEventListener('click', () => {
    capacity = Number(button.dataset.capacity);
    capacityCode.textContent = `${capacity}`;
    for (const option of document.querySelectorAll('[data-capacity]')) {
      option.setAttribute('aria-pressed', `${option === button}`);
    }
  });
}

document.querySelector('#run-task').addEventListener('click', runTask);
setLanguage('ru');
runTask();
