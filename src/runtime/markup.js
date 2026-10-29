// Markup: the owners of the blocks that `{if}`, `{switch}` and `{for}` remove, the
// `mount` of components, the blocks themselves, elements and the CSS of components.

import { $$runDeferred } from './core.js';

// Owners of markup that `{if}`, `{switch}` and `{for}` may remove: what the `mount` and `effect`
// of its components deferred, and the removal of the blocks inside it, run when it is removed.
// The current owner is shared by the modules of a page, since the blocks of one module may hold
// the components of another.
export const $$owner = Symbol.for('rook.owner');

export function $$owned(create) {
  const owner = { removed: false, cleanups: [] };
  const parent = globalThis[$$owner];

  globalThis[$$owner] = owner;

  let result;

  try {
    result = create();
  } finally {
    globalThis[$$owner] = parent;
  }

  const remove = () => {
    if (owner.removed) return;
    owner.removed = true;
    $$runDeferred(owner.cleanups);
  };

  return [result, remove];
}

export function $$onRemove(cleanup) {
  globalThis[$$owner]?.cleanups.push(cleanup);
}

// `mount { ... }` of a component: runs when its markup is in the document. That is checked after
// the code that creates the component; markup that is not in the document yet is waited for with a
// MutationObserver, which watches only while some markup waits. Markup that its owner removes
// before that never mounts. What its `defer`s put into `cleanups` runs when the owner is removed;
// they are added to the owner once it mounts, so the cleanups of the decorators, which mount after
// the component, run before those of the component.
export const $$waiting = new Set();
export let $$observer = null;

export function $$mount(node, mount, cleanups) {
  const entry = { node, mount, cleanups, owner: globalThis[$$owner] };

  entry.owner?.cleanups.push(() => $$waiting.delete(entry));
  queueMicrotask(() => $$tryMount(entry));
}

export function $$tryMount(entry) {
  if (entry.owner?.removed) return;

  const node = entry.node();

  if (node != null && !node.isConnected) {
    $$waiting.add(entry);
    if (!$$observer) {
      $$observer = new MutationObserver($$mountWaiting);
      $$observer.observe(node.ownerDocument ?? document, { childList: true, subtree: true });
    }

    return;
  }

  entry.mount();
  if (entry.cleanups) entry.owner?.cleanups.push(() => $$runDeferred(entry.cleanups.splice(0)));
}

export function $$mountWaiting() {
  for (const entry of $$waiting) {
    if (!entry.node().isConnected) continue;
    $$waiting.delete(entry);
    $$tryMount(entry);
  }

  if ($$waiting.size === 0) {
    $$observer.disconnect();
    $$observer = null;
  }
}

// Appends element content whose type is not known: null adds nothing, arrays add each item.
export function $$append(parent, value) {
  if (value == null || value === false) return;
  if (Array.isArray(value)) {
    for (const item of value) $$append(parent, item);
  } else {
    parent.append(value);
  }
}

// Nodes of markup that change, `{list}` or `{ok ? <b /> : null}`: they are kept before an end
// marker. Nodes that stay are moved rather than created again. Returns the markers with the first
// nodes, to be inserted, and the update.
export function $$content(value) {
  const end = document.createTextNode('');
  const fragment = document.createDocumentFragment();

  fragment.append(end);

  let nodes = [];
  let remove;
  const update = () => {
    const next = [];
    const add = (item) => {
      if (item == null || item === false) return;
      if (Array.isArray(item)) {
        for (const each of item) add(each);
      } else if (item.nodeType === 11) {
        next.push(...item.childNodes);
      } else {
        next.push(typeof item === 'object' ? item : document.createTextNode(String(item)));
      }
    };
    const [created, removeCreated] = $$owned(value);

    add(created);
    remove?.();
    remove = removeCreated;

    const kept = new Set(next);

    for (const node of nodes) if (!kept.has(node)) node.remove();
    end.before(...next);
    nodes = next;
  };

  update();
  $$onRemove(() => remove?.());

  return [fragment, update];
}

// `{if ...}` and `{switch ...}` in markup: shows the block that `choose` picks (-1 for none) between
// two markers. The block is created again only when the choice changes; otherwise it is updated.
export function $$branches(choose, blocks) {
  const start = document.createTextNode('');
  const end = document.createTextNode('');
  const fragment = document.createDocumentFragment();

  fragment.append(start, end);

  let current = null;
  let update;
  let remove;
  const render = () => {
    const next = choose();

    if (next === current) {
      update?.();

      return;
    }

    current = next;
    remove?.();
    while (start.nextSibling !== end) start.nextSibling.remove();
    update = undefined;
    remove = undefined;
    if (next >= 0) {
      const [[content, blockUpdate], removeBlock] = $$owned(blocks[next]);

      end.before(content);
      update = blockUpdate;
      remove = removeBlock;
    }
  };

  render();
  $$onRemove(() => remove?.());

  return [fragment, render];
}

// `<Page />` whose component is a value that changes: when it does, the block that `create` makes
// with it is created again between two markers; otherwise the block is updated.
export function $$dynamic(component, create) {
  const start = document.createTextNode('');
  const end = document.createTextNode('');
  const fragment = document.createDocumentFragment();

  fragment.append(start, end);

  let current;
  let update;
  let remove;
  const render = () => {
    const next = component();

    if (remove && next === current) {
      update?.();

      return;
    }

    current = next;
    remove?.();
    while (start.nextSibling !== end) start.nextSibling.remove();

    const [[content, blockUpdate], removeBlock] = $$owned(() => create(next));

    end.before(content);
    update = blockUpdate;
    remove = removeBlock;
  };

  render();
  $$onRemove(() => remove?.());

  return [fragment, render];
}

// `{for item in items { ... }}` in markup: a block for each item, between its own markers. On
// updates the blocks are found again by the item itself: blocks of items that stay are updated and
// moved into place, others are created or removed. With `key`, of `with key item.id`, they are
// found by the key instead, so an item replaced by another with the same key keeps its block,
// which gets the new item.
export function $$list(items, create, key = (item) => item) {
  const end = document.createTextNode('');
  const fragment = document.createDocumentFragment();

  fragment.append(end);

  let blocks = [];
  const nodesOf = (block) => {
    const nodes = [];

    for (let node = block.start; node !== block.end; node = node.nextSibling) nodes.push(node);
    nodes.push(block.end);

    return nodes;
  };
  const update = () => {
    const old = new Map();

    for (const block of blocks) {
      const same = old.get(block.key);

      if (same) same.push(block);
      else old.set(block.key, [block]);
    }

    const next = [];
    let index = 0;

    for (const item of items()) {
      const id = key(item, index);
      let block = old.get(id)?.shift();

      if (block) {
        block.update?.(index, item);
      } else {
        const [[content, blockUpdate], remove] = $$owned(() => create(item, index));

        block = { key: id, start: document.createTextNode(''), end: document.createTextNode('') };
        block.update = blockUpdate;
        block.remove = remove;
        block.content = document.createDocumentFragment();
        block.content.append(block.start, content, block.end);
      }

      next.push(block);
      index++;
    }

    for (const same of old.values()) {
      for (const block of same) {
        block.remove();
        for (const node of nodesOf(block)) node.remove();
      }
    }

    let before = end;

    for (let i = next.length - 1; i >= 0; i--) {
      const block = next[i];

      if (block.content) {
        before.before(block.content);
        block.content = null;
      } else if (block.end.nextSibling !== before) {
        before.before(...nodesOf(block));
      }

      before = block.start;
    }

    blocks = next;
  };

  update();
  $$onRemove(() => {
    for (const block of blocks) block.remove();
  });

  return [fragment, update];
}

// Creates an element with its properties and the attributes that are set with setAttribute.
export function $$element(tag, properties, attributes) {
  const element = Object.assign(document.createElement(tag), properties);

  for (const name in attributes) element.setAttribute(name, attributes[name]);

  return element;
}

// Creates an SVG element with its attributes.
export function $$svgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);

  for (const name in attributes) element.setAttribute(name, attributes[name]);

  return element;
}

// The class of `class={[styles.tab, active ? styles.active : null]}`: the classes that are not
// null or empty, separated by spaces.
export function $$classes(list) {
  return list.filter((each) => each).join(' ');
}

// Sets an attribute whose value may be null: then the attribute is removed.
export function $$attribute(element, name, value) {
  if (value == null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

// Adds the CSS of a component to the page once: modules that inline the same component add it with
// the same id. `styles` keeps the CSS of the module for the shadow roots of its web components,
// which the styles of the page do not reach.
export function $$style(styles, id, css) {
  styles.push(css);
  if (document.getElementById(id)) return;

  const style = document.createElement('style');

  style.id = id;
  style.textContent = css;
  document.head.append(style);
}
