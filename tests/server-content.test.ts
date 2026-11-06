import { describe, expect, it } from 'vitest';
import { get, handlerOf, runOnServer, serverErrors } from './server.ts';

// Children on the server are lazy, `Content<T>`: a function that renders them and gives what they
// give, so that a wrapper decides whether they run and gives their value; component values write
// what they give, `comp() T` (docs/server.md, "Children" and "Components as values").

const USERS = `
interface User {
    name string
}
comp Users() []User {
    console.log("users loaded")
    return [{ name: "Ann" }]
}
`;

describe('Content<T>', () => {
  it('gives what the children give, and runs them only when called', async () => {
    expect(
      await runOnServer(`${USERS}
        comp Logger<T>(children Content<T>) T {
            defer console.log("logged")
            return await children()
        }
        comp Gate<T>(open bool, children Content<T>) ?T {
            if !open {
                return null
            }
            return await children()
        }
        const users = <Logger><Users /></Logger>
        console.log(users[0].name)
        console.log(<Gate open={false}><Users /></Gate>)
      `),
    ).toEqual(['users loaded', 'logged', 'Ann', 'null']);
  });

  it('infers the result of a wrapper from its children', () => {
    const source = `${USERS}
      comp Logger<T>(children Content<T>) T {
          return await children()
      }
    `;

    expect(serverErrors(`${source}\nconst users []User = <Logger><Users /></Logger>`)).toEqual([]);
    expect(serverErrors(`${source}\nconst page Html = <Logger><p>hi</p></Logger>`)).toEqual([]);
    expect(serverErrors(`${source}\nconst n number = <Logger><Users /></Logger>`)).toEqual([
      'cannot use []User as number',
    ]);
  });

  it('is Content<Html> without an argument, which markup shows', async () => {
    expect(
      await runOnServer(`
        comp Box(children Content) {
            const inner = await children()
            return <div>{inner}</div>
        }
        console.log(<Box><b>x</b></Box>)
        console.log(<Box />)
      `),
    ).toEqual(['<div><b>x</b></div>', '<div></div>']);
  });

  it('is markup with Content, so a Response among the children goes up', async () => {
    const source = `
      import { handler, reply } from "rooklang/server"
      comp Article(id string) {
          if id == "" {
              return reply("No such post", { status: 404 })
          }
          return <p>{id}</p>
      }
      comp Layout(children Content) {
          const page = await children()
          return <main>{page}</main>
      }
      comp App(request Request) {
          return <Layout><Article id={new URL(request.url).pathname.slice(1)} /></Layout>
      }
      export const handle = handler(App)
    `;

    expect(serverErrors(source)).toEqual([]);

    const handle = await handlerOf(source);
    const missing = await handle(get('/'));

    expect([missing.status, await missing.text()]).toEqual([404, 'No such post']);
    expect(await (await handle(get('/a'))).text()).toBe('<main><p>a</p></main>');
  });

  it('checks the children against the type of Content', () => {
    expect(
      serverErrors(`${USERS}
        comp Names(children Content<[]string>) []string {
            return await children()
        }
        const names = <Names><Users /></Names>
      `),
    ).toEqual(['the children of <Names> give []User, but it takes Content<[]string>']);
  });
});

describe('components as values', () => {
  it('give what their type says, Html without a result', async () => {
    expect(
      await runOnServer(`${USERS}
        comp Home() {
            return <h1>Home</h1>
        }
        interface Route {
            page comp()
            open bool
        }
        const ROUTES { [string]: Route } = { "/": { page: Home, open: true } }
        comp Router(path string) {
            const route = ROUTES[path]
            if route == null {
                return <p>Not found</p>
            }
            return <main><route.page /></main>
        }
        const api comp() []User = Users
        const Api = api
        const users = <Api />
        console.log(<Router path="/" />, <Router path="/x" />, users.length)
      `),
    ).toEqual(['users loaded', '<main><h1>Home</h1></main> <p>Not found</p> 1']);
  });

  it('fit a type only if they give what it says', () => {
    expect(serverErrors(`${USERS}\nconst page comp() = Users`)).toEqual([
      'cannot use comp() []User as comp() Html',
    ]);
  });
});
