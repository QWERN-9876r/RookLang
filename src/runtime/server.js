// "rooklang/server": the entry of a server whose components are written with
// "rook": { "markup": "html" } (docs/server.md). The root of the tree is a component that takes
// the request; handler() makes of it a function of the web standard, Request to Response, which
// Bun, Deno and Workers serve, and serve() runs it on node:http.

import { $$Answer, $$Html } from './html.js';

/** A string known to be HTML, put into markup as it is: the only way around escaping. */
export function html(text) {
  return new $$Html(String(text));
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
 * the log.
 */
export function handler(root, props = {}) {
  return async (request) => {
    try {
      return reply(await root({ ...props, request }, {}));
    } catch (error) {
      if (error instanceof $$Answer) return error.response;
      console.error(error);

      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  };
}

/** handler() on node:http; the server listens on `port` (3000 by default) and is returned. */
export function serve(root, options = {}) {
  const fetch = handler(root, options.props);
  // Not imported, so that this module loads where there is no node:http, e.g. in Workers.
  const http = process.getBuiltinModule('node:http');
  const server = http.createServer((incoming, outgoing) => {
    fetch(requestOf(incoming)).then(
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

function bodyOf(value) {
  if (value === null || value === undefined) return [null, null];
  if (value instanceof $$Html) return [value.text, 'text/html; charset=utf-8'];
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
