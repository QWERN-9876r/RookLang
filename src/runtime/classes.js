// Data classes: `data class Point` registers its class with an id of its own, the name and a hash
// of its code, the same in a module and in its worker module, which has a copy of the class. A copy
// of a value that goes to another thread loses the class of its instances (structuredClone); the
// thread that sends lists them with their ids (threads.js), and the one that gets the copy gives
// them their class again.

function registry() {
  return (globalThis[Symbol.for('rook.classes')] ??= { byId: new Map(), ids: new WeakMap() });
}

export function $$dataClass(cls, id) {
  const { byId, ids } = registry();

  byId.set(id, cls.prototype);
  ids.set(cls.prototype, id);
}

/** The id of the data class of an instance, or undefined. */
export function $$classOf(value) {
  return registry().ids.get(Object.getPrototypeOf(value));
}

/** Gives the copies of instances their classes back: `[object, id]` pairs of a copied message. */
export function $$reclass(instances) {
  const { byId } = registry();

  for (const [object, id] of instances) {
    const prototype = byId.get(id);

    if (prototype) Object.setPrototypeOf(object, prototype);
  }
}
