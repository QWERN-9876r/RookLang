// Тот же поиск на JavaScript: ожидание, которое можно прервать, —
// это Promise, вручную связанный с сигналом, проверка ответа написана
// вручную, а каждое изменение данных перерисовывает DOM

const FRUITS = [
  { name: 'Гуава', price: 320 },
  { name: 'Киви', price: 60 },
  { name: 'Личи', price: 750 },
  { name: 'Манго', price: 240 },
  { name: 'Папайя', price: 410 },
  { name: 'Маракуйя', price: 90 },
  { name: 'Ананас', price: 380 },
  { name: 'Помело', price: 530 },
];

// То, что делает select по after(ms) и done(signal): выполняется через
// ms, отклоняется при прерывании сигнала и в обоих случаях снимает таймер
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      reject(new Error('прерван'));
    }

    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

// Тот же ненастоящий сервер
async function request(query, signal) {
  await wait(200 + Math.random() * 1000, signal);

  const q = query.toLowerCase();

  return JSON.stringify(FRUITS.filter((f) => f.name.toLowerCase().includes(q)));
}

// То, что проверяет decode<[]Fruit>
function parseFruits(body) {
  const value = JSON.parse(body);

  if (!Array.isArray(value)) throw new TypeError('ожидался массив');
  value.forEach((fruit, i) => {
    if (typeof fruit?.name !== 'string') throw new TypeError(`[${i}].name: ожидалась строка`);
    if (typeof fruit.price !== 'number') throw new TypeError(`[${i}].price: ожидалось число`);
  });

  return value;
}

const style = document.createElement('style');

style.textContent = `
  .search { display: grid; gap: 14px; max-width: 420px; }
  .field {
    padding: 10px 14px; border: 1px solid #ffffff2e; border-radius: 10px;
    background: #ffffff0a; color: inherit; font: inherit;
  }
  .field:focus { outline: none; border-color: #f5a524; }
  .fruits {
    display: grid; gap: 6px; margin: 0; padding: 0; list-style: none;
    transition: opacity 0.2s;
  }
  .fruits li {
    display: flex; justify-content: space-between; padding: 8px 12px;
    border-radius: 8px; background: #ffffff0d;
  }
  .waiting { opacity: 0.4; }
  .price { color: #f5a524; font-variant-numeric: tabular-nums; }
  .empty { margin: 0; color: #ffffff80; }
  .caption {
    margin: 0; padding-top: 12px; border-top: 1px solid #ffffff1a; color: #ffffff80;
    font-size: 0.75em; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .log { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 0.85em; }
  .log li { display: grid; grid-template-columns: 1fr auto 70px; gap: 12px; }
  .log .ms { text-align: right; color: #ffffff80; }
  .log [data-status="запрос"] { color: #ffffff99; }
  .log [data-status="показан"] { color: #6fcf8f; }
  .log [data-status="прерван"] { color: #ffffff59; text-decoration: line-through; }
  .log [data-status="плохой ответ"] { color: #ff7a7a; }
`;

const root = document.createElement('div');
const input = document.createElement('input');
const list = document.createElement('ul');
const empty = document.createElement('p');
const caption = document.createElement('p');
const logList = document.createElement('ol');

root.className = 'search';
input.className = 'field';
input.placeholder = 'Найти фрукт: наберите а, потом н';
list.className = 'fruits';
empty.className = 'empty';
empty.textContent = 'Ничего не нашлось';
caption.className = 'caption';
caption.textContent = 'Запросы, новые сверху';
logList.className = 'log';
root.append(input, list, caption, logList);
document.body.append(style, root);

let fruits = [];
let log = [];
let current = null;
let requests = 0;

// То, за чем разметка компонента следит сама: каждое изменение fruits
// или log должно вызвать эту функцию
function render() {
  const asking = log.length > 0 && log[0].status === 'запрос';

  list.className = asking ? 'fruits waiting' : 'fruits';
  list.replaceChildren(
    ...fruits.map((fruit) => {
      const item = document.createElement('li');
      const price = document.createElement('span');

      price.className = 'price';
      price.textContent = `${fruit.price} ₽`;
      item.append(fruit.name, price);

      return item;
    }),
  );
  if (fruits.length === 0 && !asking) list.after(empty);
  else empty.remove();
  logList.replaceChildren(
    ...log.map((r) => {
      const item = document.createElement('li');
      const ms = document.createElement('span');

      item.dataset.status = r.status;
      ms.className = 'ms';
      ms.textContent = r.status === 'запрос' ? '…' : `${r.ms} мс`;
      item.append(span(r.query === '' ? 'все' : `«${r.query}»`), span(r.status), ms);

      return item;
    }),
  );
}

function span(text) {
  const element = document.createElement('span');

  element.textContent = text;

  return element;
}

async function search(query) {
  current?.abort();

  const controller = new AbortController();
  const signal = controller.signal;

  current = controller;
  try {
    await wait(300, signal);
  } catch {
    return; // клавиша, нажатая до паузы
  }

  requests += 1;

  const id = requests;
  const start = performance.now();

  log = [{ id, query, status: 'запрос', ms: 0 }, ...log].slice(0, 5);
  render();

  const end = (status) => {
    const ms = Math.round(performance.now() - start);

    log = log.map((r) => (r.id === id ? { id, query, status, ms } : r));
    render();
  };

  let body;

  try {
    body = await request(query, signal);
  } catch {
    end('прерван');

    return;
  }

  try {
    fruits = parseFruits(body);
  } catch (error) {
    console.log(error.message);
    end('плохой ответ');

    return;
  }

  end('показан');
}

input.addEventListener('input', () => search(input.value));
search('');
