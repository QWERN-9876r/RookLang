import { chanOf } from './channel.ts';
import { PROMISE } from './promise.ts';
import {
  ANY,
  arrayOf,
  BOOL,
  ERROR,
  func,
  instantiate,
  method,
  nullable,
  NUMBER,
  property,
  STRING,
  topicOf,
  VOID,
  type Member,
  type ObjectType,
  type Type,
  type TypeParam,
} from './types.ts';

// `Channel` and `Topic`: what `<-`, `close` and the rest compile to, by name, for code that needs
// them as functions. `Channel.EMPTY` and `Topic.EMPTY` are the zero values of their types: closed,
// and a `chan any` and a `topic any`, so that they go where a channel or topic of any values is
// expected (src/runtime/channel.js, src/runtime/topic.js).

const T: TypeParam = { kind: 'param', name: 'T' };

function generic(params: Type[], results: Type[]): Member {
  return method(func(params, results, { typeParams: [T] }));
}

function object(name: string, members: Record<string, Member>): ObjectType {
  return { kind: 'object', name, members: new Map(Object.entries(members)), call: null };
}

export const CHANNEL_OBJECT: ObjectType = object('Channel', {
  EMPTY: property(chanOf(ANY)),
  make: generic([NUMBER, T], [chanOf(T)]),
  send: generic([chanOf(T, 'send'), T], [instantiate(PROMISE, [VOID])]),
  // The zero value of its type after close; null from Channel.EMPTY.
  receive: generic([chanOf(T, 'receive')], [instantiate(PROMISE, [nullable(T)])]),
  close: method(func([chanOf(ANY)], [])),
  // An async iterator of the values, for `for await` of JS.
  range: generic([chanOf(T, 'receive')], [ANY]),
  select: method(func([arrayOf(ANY), BOOL], [instantiate(PROMISE, [arrayOf(ANY)])])),
  try: method(func([chanOf(ANY), BOOL, ANY], [nullable(arrayOf(ANY))], { required: 2 })),
  fromStream: method(func([ANY, NUMBER, ANY], [chanOf(ANY), chanOf(ERROR, 'receive')])),
  stream: generic([chanOf(T, 'receive')], [ANY]),
  after: method(func([NUMBER], [chanOf(NUMBER, 'receive')])),
  tick: method(func([NUMBER], [chanOf(NUMBER)])),
});

export const TOPIC_OBJECT: ObjectType = object('Topic', {
  EMPTY: property(topicOf(ANY)),
  make: generic([STRING, T], [topicOf(T)]),
  publish: generic([topicOf(T), T], []),
  listen: generic([topicOf(T)], [chanOf(T, 'receive')]),
  close: method(func([topicOf(ANY)], [])),
});
