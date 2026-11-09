// Markup on the server ("rook": { "markup": "html" }, docs/server.md): a string of HTML in an
// object of its own, so that what is already HTML is told from text that must be escaped, and the
// template that markup compiles to, which waits for the components among its values.

/** Markup that is already HTML: put into other markup as it is, where a string is escaped. */
export class $$safeHtml {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }

  toJSON() {
    return this.text;
  }
}

/** Thrown when a Response is among the children of markup: handler() of server.js sends it. */
export class $$answer {
  constructor(response) {
    this.response = response;
  }

  // `try` of try.js lets it go up by this mark: try.js is in every bundle and does not import this
  // file of the server.
  get [Symbol.for('rooklang.answer')]() {
    return true;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text and the values of attributes, escaped for HTML. */
export function $$escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * `<p>{name}</p>` is $$html`<p>${name}</p>`. The components among the values are Promises, which
 * all started when the template was evaluated: the markup waits for all of them, so that they run
 * side by side, and gives a Promise then. Without them it is Html at once.
 */
export function $$html(strings, ...values) {
  if (!values.some(isPending)) return new $$safeHtml(joined(strings, values));

  return settled(values).then((done) => new $$safeHtml(joined(strings, done)));
}

/** ` name="value"` of an attribute: nothing for null and false, the name alone for true. */
export function $$attr(name, value) {
  if (typeof value === 'boolean' && name.startsWith('aria-')) value = String(value);
  if (value === null || value === undefined || value === false) return new $$safeHtml('');
  if (value === true) return new $$safeHtml(` ${name}`);
  // `class={[styles.tab, active ? styles.active : null]}`
  if (Array.isArray(value)) value = value.filter((each) => each != null && each !== '').join(' ');

  return new $$safeHtml(` ${name}="${$$escape(value)}"`);
}

/** `{...attributes}` of an element: each field is an attribute. */
export function $$attrs(attributes) {
  const parts = Object.entries(attributes ?? {})
    .filter(([, value]) => typeof value !== 'function')
    .map(([name, value]) => $$attr(name, value).text);

  return new $$safeHtml(parts.join(''));
}

/**
 * `needs session` of a component: the public members of @session, which a component above gave.
 * Where none did, the request fails: the checker sees only the uses of components by name.
 */
export function $$need(context, decorator, component) {
  const members = context[decorator];

  if (members === undefined) {
    throw new Error(`${component} needs @${decorator} from a component above it`);
  }

  return members;
}

/** The context of the components below one: with the members of the decorators it applies. */
export function $$provide(context, given) {
  return { ...context, ...given };
}

function isPending(value) {
  if (Array.isArray(value)) return value.some(isPending);

  return value !== null && typeof value === 'object' && typeof value.then === 'function';
}

/**
 * The values with what their Promises give. All of them end before the first error is thrown, so
 * that the `defer` of every component that started runs before the request ends.
 */
async function settled(values) {
  const results = await Promise.allSettled(values.map(resolved));
  const failed = results.find((result) => result.status === 'rejected');

  if (failed) throw failed.reason;

  return results.map((result) => result.value);
}

async function resolved(value) {
  if (Array.isArray(value)) return settled(value);

  const done = await value;

  return isPending(done) ? resolved(done) : done;
}

function joined(strings, values) {
  let text = strings[0];

  for (let i = 0; i < values.length; i++) text += rendered(values[i]) + strings[i + 1];

  return text;
}

function rendered(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (value instanceof $$safeHtml) return value.text;
  if (Array.isArray(value)) return value.map(rendered).join('');
  // A redirect, a 404: the rendering of the whole request stops, and this is the answer.
  if (typeof Response !== 'undefined' && value instanceof Response) throw new $$answer(value);

  return $$escape(value);
}
