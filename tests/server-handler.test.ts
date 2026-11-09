import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { get, handlerOf, importServer, serverErrors } from './server.ts';

// The entry of a server: handler(App) of "rooklang/server" turns the result of the root into a
// Response, and a Response among the children of markup goes up and becomes the answer
// (docs/server.md, "The entry point" and "A Response goes up").

const PAGE = `
import { handler, reply } from "rooklang/server"

comp Layout(title string, children Content) {
    return <html><head><title>{title}</title></head><body>{children}</body></html>
}
`;

describe('handler', () => {
  it('gives the root the request and sends Html as a page', async () => {
    const handle = await handlerOf(`${PAGE}
      comp App(request Request) {
          const url = new URL(request.url)
          return <Layout title="Home"><p>{url.pathname}</p></Layout>
      }
      export const handle = handler(App)
    `);
    const response = await handle(get('/about'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(
      '<!doctype html><html><head><title>Home</title></head><body><p>/about</p></body></html>',
    );
  });

  it('sends text, data as JSON, and 404 for null', async () => {
    const handle = await handlerOf(`${PAGE}
      interface User {
          name string
      }
      comp App(request Request) any {
          const path = new URL(request.url).pathname
          if path == "/text" {
              return "plain"
          }
          if path == "/users" {
              const users User[] = [{ name: "Ann" }]
              return users
          }
          return null
      }
      export const handle = handler(App)
    `);
    const text = await handle(get('/text'));
    const users = await handle(get('/users'));

    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await text.text()).toBe('plain');
    expect(users.headers.get('content-type')).toBe('application/json');
    expect(await users.json()).toEqual([{ name: 'Ann' }]);
    expect((await handle(get('/none'))).status).toBe(404);
  });

  it('sends 500 for an error, without the error in the body', async () => {
    const handle = await handlerOf(`${PAGE}
      comp App(request Request) Html {
          throw error("the database is down")
      }
      export const handle = handler(App)
    `);
    const logged: unknown[] = [];
    const original = console.error;

    console.error = (...args: unknown[]) => logged.push(...args);
    try {
      const response = await handle(get('/'));

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
    } finally {
      console.error = original;
    }

    expect(String(logged[0])).toContain('the database is down');
  });

  it('passes other properties to the root', async () => {
    const handle = await handlerOf(`${PAGE}
      comp App(request Request, greeting string) {
          return <p>{greeting}</p>
      }
      export const handle = handler(App, { greeting: "hi" })
    `);

    expect(await (await handle(get('/'))).text()).toBe('<p>hi</p>');
  });

  it('takes the properties of each request from a function', async () => {
    // The server of Bun comes after the request, as `fetch(request, server)` of Bun.serve gives it;
    // its type comes from where the function goes, as from the .d.ts of Bun.serve.
    const module = await importServer(`${PAGE}
      interface Peer {
          address string
      }
      interface Platform {
          requestIP(request Request) Peer
      }
      func serveLike(fetch func(Request, Platform) Promise<Response>) func(Request, Platform) Promise<Response> {
          return fetch
      }
      comp App(request Request, ip string, path string) {
          return <p>{ip} {path}</p>
      }
      export const handle = serveLike(handler(App, (request, server) => ({
          ip: server.requestIP(request).address,
          path: new URL(request.url).pathname,
      })))
      export const later = handler(App, async request => {
          await new Promise(resolve => setTimeout(resolve, 1))
          return { ip: "none", path: request.method }
      })
    `);
    const handle = module.handle as (request: Request, server: unknown) => Promise<Response>;
    const later = module.later as (request: Request) => Promise<Response>;
    const server = { requestIP: () => ({ address: '10.0.0.1' }) };

    expect(await (await handle(get('/a'), server)).text()).toBe('<p>10.0.0.1 /a</p>');
    expect(await (await later(get('/'))).text()).toBe('<p>none GET</p>');
    // An error of the function is one of the request.
    expect((await handle(get('/a'), {})).status).toBe(500);
    // Without a place that says it, the type of what comes after the request is written.
    expect(
      serverErrors(`${PAGE}
comp App(request Request, ip string) {
    return <p>{ip}</p>
}
const handle = handler(App, (request, server) => ({ ip: "x" }))
const response Promise<Response> = handle(new Request("http://localhost/"))`),
    ).toEqual(['cannot infer the type of parameter "server": add a type']);
  });
});

describe('a Response goes up', () => {
  it('stops the rendering and becomes the answer, after the others end', async () => {
    const module = await importServer(`${PAGE}
      export const log string[] = []
      comp Slow() {
          defer log.push("slow closed")
          <-after(10)
          return <b>slow</b>
      }
      comp Account(signedIn bool) {
          if !signedIn {
              return Response.redirect("http://localhost/login", 303)
          }
          return <section>account</section>
      }
      comp App(request Request) {
          const signedIn = new URL(request.url).searchParams.has("user")
          return <Layout title="Account"><Slow /><Account signedIn={signedIn} /></Layout>
      }
      export const handle = handler(App)
    `);
    const handle = module.handle as (request: Request) => Promise<Response>;
    const redirect = await handle(get('/account'));

    expect(redirect.status).toBe(303);
    expect(redirect.headers.get('location')).toBe('http://localhost/login');
    expect(module.log).toEqual(['slow closed']);
    expect(await (await handle(get('/account?user=1'))).text()).toContain(
      '<b>slow</b><section>account</section>',
    );
  });

  it('is a value outside markup: the tag gives it', () => {
    expect(
      serverErrors(`
        comp Account(signedIn bool) {
            if !signedIn {
                return Response.redirect("http://localhost/login", 303)
            }
            return <section>account</section>
        }
        const page = <Account signedIn={false} />
        const html Html = page
      `),
    ).toEqual(['cannot use Response | Html as Html']);
  });
});

describe('reply', () => {
  it('sets the status and the headers of a page, text or data', async () => {
    const handle = await handlerOf(`${PAGE}
      comp App(request Request) {
          const path = new URL(request.url).pathname
          if path == "/data" {
              return reply({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } })
          }
          return reply(<p>Not found</p>, { status: 404 })
      }
      export const handle = handler(App)
    `);
    const missing = await handle(get('/x'));
    const data = await handle(get('/data'));

    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await missing.text()).toBe('<p>Not found</p>');
    expect(data.status).toBe(201);
    expect(data.headers.get('cache-control')).toBe('no-store');
    expect(await data.json()).toEqual({ ok: true });
  });
});

describe('html and serve', () => {
  it('html() puts trusted HTML in as it is', async () => {
    const handle = await handlerOf(`
      import { handler, html } from "rooklang/server"
      comp App(request Request) {
          return <article>{html("<em>trusted</em>")}{"<em>text</em>"}</article>
      }
      export const handle = handler(App)
    `);

    expect(await (await handle(get('/'))).text()).toBe(
      '<article><em>trusted</em>&lt;em&gt;text&lt;/em&gt;</article>',
    );
  });

  it('serve() answers requests of node:http', async () => {
    const module = await importServer(`
      import { serve } from "rooklang/server"
      comp App(request Request, local bool) {
          return <p>{request.method} {new URL(request.url).pathname} {local ? "local" : "remote"}</p>
      }
      // The IncomingMessage of node:http comes after the request.
      export const server = serve(App, {
          port: 0,
          props: (request, incoming) => ({ local: incoming.socket.remoteAddress != null }),
      })
    `);
    const server = module.server as Server;

    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://localhost:${port}/hello`);

      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await response.text()).toBe('<p>GET /hello local</p>');
    } finally {
      server.close();
    }
  });
});
