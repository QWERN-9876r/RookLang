import { instantiate } from './generics.ts';
import type { ObjectType, Type } from './model.ts';

// `topic T`, made by `topic<T>(name)`: values that go to the other tabs of a site over a
// BroadcastChannel. A topic type is an instance of a generic object without members, as a channel
// type is, written and printed by its own syntax; only a topic of the same values is assignable to
// it (relations.ts), since a topic both sends and receives them.

const TOPIC: ObjectType = {
  kind: 'object',
  name: 'topic',
  members: new Map(),
  call: null,
  typeParams: [{ kind: 'param', name: 'T' }],
};

export function topicOf(element: Type): ObjectType {
  return instantiate(TOPIC, [element]);
}

/** Whether a type is `topic T`. */
export function isTopic(type: Type): boolean {
  return type.kind === 'object' && type.instanceOf?.template === TOPIC;
}

/** The type of the values of a topic type. */
export function topicElement(topic: Type): Type {
  return (topic as ObjectType).instanceOf!.args[0]!;
}
