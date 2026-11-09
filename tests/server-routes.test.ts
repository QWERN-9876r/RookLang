import { describe, expect, it } from 'vitest';
import { get, handlerOf, serverErrors } from './server.ts';

// `route("/users/:id", UserPage)` of "rooklang/server": the parameters of the path are checked
// against the properties of the page, and `match` gives the page with them, or null
// (docs/server.md, "Routes").

const PAGES = `
import { route, Route, reply, handler } from "rooklang/server"

comp Home() {
    return <h1>home</h1>
}

comp UserPage(id string) {
    return <h1>user {id}</h1>
}

comp Take(code string, line string, tab ?string) {
    return <p>{code}:{line}:{tab ?? "-"}</p>
}
`;

describe('route()', () => {
  it('serves the page whose path matches, with its parameters', async () => {
    const handle = await handlerOf(`${PAGES}
      const ROUTES Route[] = [
          route("/", Home),
          route("/users/:id", UserPage),
          route(\`/lobbies/:code/takes/:line\`, Take),
      ]

      comp App(request Request) {
          const path = new URL(request.url).pathname
          for each in ROUTES {
              const Page = each.match(path)
              if Page != null {
                  return <Page />
              }
          }
          return reply("Not Found", { status: 404 })
      }

      export const handle = handler(App)
    `);
    const text = async (path: string) => (await handle(get(path))).text();

    expect(await text('/')).toBe('<h1>home</h1>');
    expect(await text('/users/a%20b/')).toBe('<h1>user a b</h1>');
    expect(await text('/lobbies/x/takes/2')).toBe('<p>x:2:-</p>');
    expect((await handle(get('/users'))).status).toBe(404);
    expect((await handle(get('/users/%E0%A4%A'))).status).toBe(404);
  });

  it('gives Route<T> of what the page gives', () => {
    expect(
      serverErrors(`${PAGES}
        comp Users() string[] {
            return ["a"]
        }
        const api Route<string[]> = route("/users", Users)
        const page Route = route("/", Home)
        const both Route<Html | string[]>[] = [api, page]
        const wrong Route = api`),
    ).toEqual([
      'cannot use Route<string[]> as Route<Html>: "match" is func(string) ?comp() string[], not func(string) ?comp() Html',
    ]);
  });

  it.each([
    [
      'route("/users/:uid", UserPage)',
      'UserPage has no property "uid" for ":uid" of "/users/:uid": rename it to ":id", or add the property',
    ],
    [
      'route("/takes/:line", Take)',
      'Take needs the property "code", which "/takes/:line" does not give: add ":code" to the path, or give the property a default value',
    ],
    ['route("/count/:n", Count)', '":n" of "/count/:n" is a string, but "n" of Count is number'],
    ['route("/a/:id/:id", UserPage)', 'the path has ":id" twice: give each parameter its own name'],
    [
      'route("/a/:", Home)',
      '":" is not a parameter: a parameter is ":" and a name, e.g. /users/:id',
    ],
    [
      'route(prefix + "/:id", UserPage)',
      'the path of a route is a string literal, so that its parameters are checked: e.g. route("/users/:id", UserPage)',
    ],
    [
      'route("/", "home")',
      'the page of a route is a component, not string: e.g. route("/users/:id", UserPage)',
    ],
  ])('rejects %s', (call, ...messages) => {
    expect(
      serverErrors(`${PAGES}
        comp Count(n number) {
            return <p>{n}</p>
        }
        const prefix = "/users"
        const r = ${call}`),
    ).toEqual(messages);
  });
});
