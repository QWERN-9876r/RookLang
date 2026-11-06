import type { ModuleExports } from './context.ts';
import {
  ANY,
  createClass,
  func,
  nullable,
  NUMBER,
  property,
  STRING,
  type ObjectType,
  type Type,
} from './types.ts';

// The types of the server ("rook": { "markup": "html" }, docs/server.md): Html, what markup gives
// there, and the exports of "rooklang/server", which the checker knows itself, so that the
// browser compiler, without TypeScript declarations, types them too.

export { SERVER_MODULE } from '../runtime-module.ts';

/**
 * A string of HTML: a class of its own, so that a string is not taken for one. Its text is
 * private, as in $$Html of the runtime, which makes the class nominal: no other object is an Html.
 */
const HTML_CLASS = createClass('Html');

HTML_CLASS.members.set('text', { ...property(STRING, HTML_CLASS), visibility: 'private' });

export const HTML = HTML_CLASS.instance;

/** `Content<T>`: the children of a component, which it renders by calling them. */
const CONTENT_TEMPLATE: ObjectType = {
  kind: 'object',
  name: 'Content',
  members: new Map(),
  call: null,
  typeParams: [{ kind: 'param', name: 'T', constraint: null }],
};

/**
 * The children of a component on the server: a function that renders them and gives what they
 * give, `T`, which is Html for markup. `Content` alone is `Content<Html>`.
 */
export function contentOf(result: Type): ObjectType {
  return {
    kind: 'object',
    name: 'Content',
    members: new Map(),
    call: func([], [result]),
    instanceOf: { template: CONTENT_TEMPLATE, args: [result] },
  };
}

/** What the children give, if the type is `Content<T>` of the server. */
export function contentResult(type: Type): Type | null {
  return type.kind === 'object' && type.instanceOf?.template === CONTENT_TEMPLATE
    ? type.instanceOf.args[0]!
    : null;
}

/** `{ "Cache-Control": "no-store" }`: names of headers and their values. */
const HEADERS: ObjectType = {
  kind: 'object',
  name: null,
  members: new Map(),
  call: null,
  index: STRING,
};

/** The other properties of the root, `{ db: pool }`. */
const PROPS: ObjectType = {
  kind: 'object',
  name: null,
  members: new Map(),
  call: null,
  index: ANY,
};

/** `{ status: 404, headers: { ... } }` of `reply`. */
const REPLY_INIT: ObjectType = {
  kind: 'object',
  name: 'ReplyInit',
  members: new Map([
    ['status', property(nullable(NUMBER))],
    ['headers', property(nullable(HEADERS))],
  ]),
  call: null,
};

/** `{ port: 8080, hostname: "0.0.0.0", props: { ... } }` of `serve`. */
const SERVE_OPTIONS: ObjectType = {
  kind: 'object',
  name: 'ServeOptions',
  members: new Map([
    ['port', property(nullable(NUMBER))],
    ['hostname', property(nullable(STRING))],
    ['props', property(nullable(PROPS))],
  ]),
  call: null,
};

/** The exports of "rooklang/server", with the Request and Response of the library, if known. */
export function serverExports(request: Type, response: Type): ModuleExports {
  return {
    values: new Map<string, Type>([
      ['html', func([STRING], [HTML])],
      ['reply', func([ANY, nullable(REPLY_INIT)], [response], { required: 1 })],
      // The root is a component that takes the request, used as a value.
      ['handler', func([ANY, nullable(PROPS)], [func([request], [ANY])], { required: 1 })],
      ['serve', func([ANY, nullable(SERVE_OPTIONS)], [ANY], { required: 1 })],
    ]),
    types: new Map([['Html', HTML]]),
  };
}
