import type { ModuleExports } from './context.ts';
import { promiseOf } from './promise.ts';
import {
  ANY,
  createClass,
  func,
  instantiate,
  nullable,
  NUMBER,
  property,
  STRING,
  union,
  VOID,
  type ObjectType,
  type Type,
  type TypeParam,
} from './types.ts';

// The types of the server ("rook": { "markup": "html" }, docs/server.md): Html, what markup gives
// there, and the exports of "rooklang/server", which the checker knows itself, so that the
// browser compiler, without TypeScript declarations, types them too.

export { SERVER_MODULE } from '../runtime-module.ts';

/**
 * A string of HTML: a class of its own, so that a string is not taken for one. Its text is
 * private, as in $$safeHtml of the runtime, which makes the class nominal: no other object is an Html.
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

/** The result of the page of a route, T of `Route<T>`; Html when it is not written. */
const PAGE: TypeParam = { kind: 'param', name: 'T', constraint: null, default: HTML };

/**
 * `Route<T>` of `route("/users/:id", UserPage)`: its path, and `match`, which gives the page with
 * the parameters of the path as its properties, `comp() T`, or null for another path.
 */
const ROUTE_TEMPLATE: ObjectType = {
  kind: 'object',
  name: 'Route',
  members: new Map([
    ['path', property(STRING)],
    [
      'match',
      property(func([STRING], [nullable({ kind: 'component', params: [], result: PAGE })])),
    ],
  ]),
  call: null,
  typeParams: [PAGE],
};

/** `Route<T>` of a page that gives T. */
export function routeOf(result: Type): ObjectType {
  return instantiate(ROUTE_TEMPLATE, [result]);
}

/**
 * `route(path, page)`. The page is any component here: the checker checks the call itself
 * (src/checker/routes.ts), the parameters of the path against the properties of the page.
 */
export const ROUTE_FUNCTION = func([STRING, ANY], [routeOf(HTML)]);

/**
 * The types of the library that "rooklang/server" uses, any where they are not known (the
 * playground has no lib files and no @types/node).
 */
export interface ServerLibrary {
  request: Type;
  response: Type;
  promise: Type | undefined;
  /** IncomingMessage and Server of node:http. */
  incoming: Type;
  server: Type;
}

/** The exports of "rooklang/server", with the types of the library. */
export function serverExports(library: ServerLibrary): ModuleExports {
  const { request, response, promise } = library;
  // What the platform gives after the request, as the server of Bun, `fetch(request, server)`, or
  // `env` and `ctx` of Workers: inferred from where the function goes,
  // `Bun.serve({ fetch: handler(App, (request, server) => ...) })`, or from the types written in
  // the function of the properties. Without them it is nothing, void, which a call leaves out.
  const A: TypeParam = { kind: 'param', name: 'A', default: VOID };
  const B: TypeParam = { kind: 'param', name: 'B', default: VOID };
  const answer = promiseOf(promise, [response]);
  // The properties of the root, or a function that gives them for each request, which may wait.
  // Not overloads: an error in the body of the root, checked as the argument, would fit none of
  // them and be lost.
  const given = union([PROPS, promiseOf(promise, [PROPS])]);
  const props = nullable(union([PROPS, func([request, A, B], [given])]));
  // `props` of serve() gets the IncomingMessage of node:http after the request.
  const options: ObjectType = {
    ...SERVE_OPTIONS,
    members: new Map([
      ...SERVE_OPTIONS.members,
      ['props', property(nullable(union([PROPS, func([request, library.incoming], [given])])))],
    ]),
  };

  return {
    values: new Map<string, Type>([
      ['html', func([STRING], [HTML])],
      ['reply', func([ANY, nullable(REPLY_INIT)], [response], { required: 1 })],
      // The root is a component that takes the request, used as a value.
      [
        'handler',
        func([ANY, props], [func([request, A, B], [answer])], { required: 1, typeParams: [A, B] }),
      ],
      ['serve', func([ANY, nullable(options)], [library.server], { required: 1 })],
      ['route', ROUTE_FUNCTION],
    ]),
    types: new Map<string, Type>([
      ['Html', HTML],
      ['Route', ROUTE_TEMPLATE],
    ]),
  };
}
