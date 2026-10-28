// The same uploads in JavaScript: the uploaders share a counter instead
// of a channel, waiting that an abort can stop is a Promise wired to
// the signal by hand, and every change of a row redraws the page

const FILES = [
  { name: 'beach.jpg', size: 1200 },
  { name: 'notes.pdf', size: 300 },
  { name: 'cat.png', size: 800 },
  { name: 'song.mp3', size: 1500 },
  { name: 'plan.docx', size: 400 },
  { name: 'forest.jpg', size: 1100 },
  { name: 'budget.xlsx', size: 250 },
  { name: 'talk.mp4', size: 1400 },
  { name: 'logo.svg', size: 150 },
  { name: 'city.jpg', size: 900 },
];

const TRIES = 3;
const TIMEOUT = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The same pretend server; what select over after() and done() does is
// a timer that the abort of the signal has to clear
function upload(file, signal) {
  const fate = Math.random();

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', abort);
        resolve(fate > 0.75 ? new Error('server error') : null);
      },
      fate < 1 / 6 ? 60_000 : file.size,
    );

    function abort() {
      clearTimeout(timer);
      resolve(new Error('timed out'));
    }

    signal.addEventListener('abort', abort, { once: true });
  });
}

const style = document.createElement('style');

style.textContent = `
  .uploads { display: grid; gap: 12px; max-width: 480px; }
  .top { display: flex; align-items: center; gap: 12px; }
  .summary { color: #ffffffb3; font-size: 0.9em; }
  .uploads button {
    padding: 6px 14px; border: 1px solid #f5a524; border-radius: 8px;
    background: #f5a524; color: #000; font: inherit; cursor: pointer;
  }
  .uploads button:disabled { opacity: 0.4; cursor: default; }
  .lanes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .lane {
    display: grid; gap: 2px; padding: 8px 10px; border-top: 3px solid var(--by);
    border-radius: 8px; background: #ffffff0d; font-size: 0.85em;
  }
  .lane span { color: #ffffff80; }
  .files { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .files li {
    display: grid; grid-template-columns: 1fr auto 150px; gap: 12px; padding: 6px 12px;
    border-left: 3px solid var(--by, transparent); border-radius: 8px;
    background: #ffffff0a; font-size: 0.9em;
  }
  .size { color: #ffffff59; font-variant-numeric: tabular-nums; }
  .status { text-align: right; }
  [data-by="1"] { --by: #f5a524; }
  [data-by="2"] { --by: #5eb1ff; }
  [data-by="3"] { --by: #c48cff; }
  [data-status="queued"] .status { color: #ffffff59; }
  [data-status="uploading"] .status { color: #ffffff; }
  [data-status="retrying"] .status { color: #f5a524; }
  [data-status="done"] .status { color: #6fcf8f; }
  [data-status="failed"] .status { color: #ff7a7a; }
`;

function element(tag, className, text = '') {
  const node = document.createElement(tag);

  node.className = className;
  node.textContent = text;

  return node;
}

const again = element('button', '', 'Upload again');
const summary = element('span', 'summary');
const top = element('div', 'top');
const lanes = element('div', 'lanes');
const list = element('ul', 'files');
const root = element('div', 'uploads');

top.append(again, summary);
root.append(top, lanes, list);
document.body.append(style, root);

let rows = [];
let running = false;

// The file that an uploader is busy with now, if any
function busy(by) {
  return rows.find(
    (row) => row.by === by && (row.status === 'uploading' || row.status === 'retrying'),
  );
}

// What the markup of the component follows by itself
function render() {
  const sent = rows.filter((row) => row.status === 'done').length;
  const failed = rows.filter((row) => row.status === 'failed').length;

  again.disabled = running;
  summary.textContent = `${sent} sent · ${failed} failed`;
  lanes.replaceChildren(
    ...[1, 2, 3].map((by) => {
      const lane = element('div', 'lane');
      const row = busy(by);

      lane.dataset.by = by;
      lane.append(
        element('b', '', `Uploader ${by}`),
        element('span', '', row ? row.file.name : running ? 'taking the next' : 'done'),
      );

      return lane;
    }),
  );
  list.replaceChildren(
    ...rows.map((row) => {
      const item = element('li', '');

      item.dataset.status = row.status;
      item.dataset.by = row.by;
      item.append(
        element('span', '', row.file.name),
        element('span', 'size', `${row.file.size} KB`),
        element('span', 'status', row.status + (row.note === '' ? '' : ` · ${row.note}`)),
      );

      return item;
    }),
  );
}

function set(i, by, status, note) {
  rows = rows.map((row, j) => (j === i ? { file: row.file, status, note, by } : row));
  render();
}

async function deliver(i, by) {
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    set(i, by, 'uploading', attempt === 1 ? '' : `try ${attempt}`);

    const start = performance.now();
    const err = await upload(FILES[i], AbortSignal.timeout(TIMEOUT));

    if (err === null) {
      const ms = `${Math.round(performance.now() - start)} ms`;

      set(i, by, 'done', attempt === 1 ? ms : `try ${attempt}, ${ms}`);

      return;
    }

    const last = attempt === TRIES;

    set(i, by, last ? 'failed' : 'retrying', err.message);
    if (!last) await sleep(300 * attempt);
  }
}

async function start() {
  running = true;
  rows = FILES.map((file) => ({ file, status: 'queued', note: '', by: 0 }));
  render();

  // The uploaders take the next index from a counter they share
  let next = 0;
  const uploader = async (by) => {
    while (next < FILES.length) await deliver(next++, by);
  };

  await Promise.all([uploader(1), uploader(2), uploader(3)]);
  running = false;
  render();
}

again.addEventListener('click', start);
start();
