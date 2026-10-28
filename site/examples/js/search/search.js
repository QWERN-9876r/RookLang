// The same search in JavaScript: waiting that an abort can stop is a
// Promise wired to the signal by hand, the check of the answer is
// written by hand, and each change of the data redraws the DOM

const FRUITS = [
  { name: 'Guava', price: 3.2 },
  { name: 'Kiwi', price: 0.6 },
  { name: 'Lychee', price: 7.5 },
  { name: 'Mango', price: 2.4 },
  { name: 'Papaya', price: 4.1 },
  { name: 'Passion fruit', price: 0.9 },
  { name: 'Pineapple', price: 3.8 },
  { name: 'Pomelo', price: 5.3 },
];

// What select over after(ms) and done(signal) does: resolves after ms,
// rejects when the signal aborts, and clears the timer either way
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }

    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

// The same pretend server
async function request(query, signal) {
  await wait(200 + Math.random() * 1000, signal);

  const q = query.toLowerCase();

  return JSON.stringify(FRUITS.filter((f) => f.name.toLowerCase().includes(q)));
}

// What decode<[]Fruit> checks
function parseFruits(body) {
  const value = JSON.parse(body);

  if (!Array.isArray(value)) throw new TypeError('expected an array');
  value.forEach((fruit, i) => {
    if (typeof fruit?.name !== 'string') throw new TypeError(`[${i}].name: expected string`);
    if (typeof fruit.price !== 'number') throw new TypeError(`[${i}].price: expected number`);
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
  .log [data-status="asking"] { color: #ffffff99; }
  .log [data-status="shown"] { color: #6fcf8f; }
  .log [data-status="aborted"] { color: #ffffff59; text-decoration: line-through; }
  .log [data-status="bad answer"] { color: #ff7a7a; }
`;

const root = document.createElement('div');
const input = document.createElement('input');
const list = document.createElement('ul');
const empty = document.createElement('p');
const caption = document.createElement('p');
const logList = document.createElement('ol');

root.className = 'search';
input.className = 'field';
input.placeholder = 'Search fruit: type p, then a';
list.className = 'fruits';
empty.className = 'empty';
empty.textContent = 'Nothing found';
caption.className = 'caption';
caption.textContent = 'Requests, newest first';
logList.className = 'log';
root.append(input, list, caption, logList);
document.body.append(style, root);

let fruits = [];
let log = [];
let current = null;
let requests = 0;

// What the markup of the component follows by itself: every change of
// fruits or log has to call this
function render() {
  const asking = log.length > 0 && log[0].status === 'asking';

  list.className = asking ? 'fruits waiting' : 'fruits';
  list.replaceChildren(
    ...fruits.map((fruit) => {
      const item = document.createElement('li');
      const price = document.createElement('span');

      price.className = 'price';
      price.textContent = `€${fruit.price.toFixed(2)}`;
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
      ms.textContent = r.status === 'asking' ? '…' : `${r.ms} ms`;
      item.append(span(r.query === '' ? 'all' : `“${r.query}”`), span(r.status), ms);

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
    return; // a key pressed before the pause
  }

  requests += 1;

  const id = requests;
  const start = performance.now();

  log = [{ id, query, status: 'asking', ms: 0 }, ...log].slice(0, 5);
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
    end('aborted');

    return;
  }

  try {
    fruits = parseFruits(body);
  } catch (error) {
    console.log(error.message);
    end('bad answer');

    return;
  }

  end('shown');
}

input.addEventListener('input', () => search(input.value));
search('');
