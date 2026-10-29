// State of a module, `state items []Item = []` at its top level: the set of the updates of the
// components that read it, which every change of it runs.

import { $$onRemove } from './markup.js';

// A component adds its update while it is on the page: `{if}`, `{switch}` or `{for}` that removes
// it takes the update away.
export function $$watch(listeners, update) {
  listeners.add(update);
  $$onRemove(() => listeners.delete(update));
}

// After a change of the state: the updates run on a copy, since one may remove a component, or
// add one, that listens too.
export function $$changed(listeners) {
  for (const update of [...listeners]) update();
}
