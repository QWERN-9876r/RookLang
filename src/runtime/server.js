// "rooklang/server": the entry of a server whose components are written with
// "rook": { "markup": "html" } (docs/server.md). The root of the tree is a component that takes
// the request; handler() makes of it a function of the web standard, Request to Response, which
// Bun, Deno and Workers serve, and serve() runs it on node:http.

import { $$answer, $$safeHtml } from './html.js';

/** A string known to be HTML, put into markup as it is: the only way around escaping. */
export function html(text) {
  return new $$safeHtml(String(text));
}

/** The response for a value, with the status and the headers of `init`. */
export function reply(value, init = {}) {
  if (value instanceof Response) return value;

  const headers = new Headers(init.headers);
  const [body, type] = bodyOf(value);

  if (type !== null && !headers.has('content-type')) headers.set('content-type', type);

  return new Response(body, { status: init.status ?? (body === null ? 404 : 200), headers });
}

/**
 * `(request) => Promise<Response>` of the root: it gets the request and the other properties,
 * a Response that went up from the markup is the answer, and an error is 500 with the error in
 * the log. The properties may be a function that gives them for each request: it gets the
 * request and what the platform gives with it, as the server of Bun, `fetch(request, server)`.
 */
export function handler(root, props = {}) {
  return async (request, ...context) => {
    try {
      const own = typeof props === 'function' ? await props(request, ...context) : props;

      return reply(await root({ ...own, request }, {}));
    } catch (error) {
      if (error instanceof $$answer) return error.response;
      console.error(error);

      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  };
}

/**
 * handler() on node:http; the server listens on `port` (3000 by default) and is returned. A
 * function of the properties gets the IncomingMessage after the request: its socket has the
 * address of the client.
 */
export function serve(root, options = {}) {
  const fetch = handler(root, options.props);
  // Not imported, so that this module loads where there is no node:http, e.g. in Workers.
  const http = process.getBuiltinModule('node:http');
  const server = http.createServer((incoming, outgoing) => {
    fetch(requestOf(incoming), incoming).then(
      (response) => send(response, outgoing),
      (error) => {
        console.error(error);
        outgoing.writeHead(500).end();
      },
    );
  });

  server.listen(options.port ?? 3000, options.hostname);

  return server;
}

/**
 * `route("/users/:id", UserPage)`: `match(pathname)` gives the page with the parameters of the
 * path as its properties, a component without properties, or null for another path. Empty
 * segments do not count, so "/users/7/" is "/users/7".
 */
export function route(path, page) {
  const parts = segments(path);

  return {
    path,
    match(pathname) {
      const given = segments(pathname);

      if (given.length !== parts.length) return null;

      const params = {};

      for (const [i, part] of parts.entries()) {
        if (part.startsWith(':')) {
          const value = decoded(given[i]);

          if (value === null) return null;
          params[part.slice(1)] = value;
        } else if (part !== given[i]) {
          return null;
        }
      }

      return (props, context) => page({ ...props, ...params }, context);
    },
  };
}

function segments(path) {
  return path.split('/').filter((segment) => segment !== '');
}

/** The value of a parameter; a malformed escape, "%E0%A4%A", matches nothing. */
function decoded(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function bodyOf(value) {
  if (value === null || value === undefined) return [null, null];
  if (value instanceof $$safeHtml) return [value.text, 'text/html; charset=utf-8'];
  if (typeof value === 'string') return [value, 'text/plain; charset=utf-8'];

  return [JSON.stringify(value), 'application/json'];
}

/** The Request of an IncomingMessage of node:http. */
function requestOf(incoming) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const each of Array.isArray(value) ? value : [value ?? '']) headers.append(name, each);
  }

  const url = `http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`;
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
  const { Readable } = process.getBuiltinModule('node:stream');

  return new Request(url, {
    method: incoming.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
  });
}

/** Writes a Response to the ServerResponse of node:http. */
async function send(response, outgoing) {
  const headers = {};

  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value;
  });

  const cookies = response.headers.getSetCookie();

  if (cookies.length > 0) headers['set-cookie'] = cookies;
  outgoing.writeHead(response.status, headers);
  if (response.body) {
    for await (const chunk of response.body) outgoing.write(chunk);
  }

  outgoing.end();
}
