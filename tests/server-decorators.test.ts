import { describe, expect, it } from 'vitest';
import { get, handlerOf, runOnServer, serverErrors } from './server.ts';

// Decorators on the server: their bodies may wait, an early `return` is a guard that answers
// instead of the component, a wrapper takes and gives any value, and a decorator that a component
// above applies is the context of the components below, which name it with `needs`
// (docs/server.md, "Decorators on the server" and "Context").

const SESSION = `
import { handler, reply } from "rooklang/server"

interface User {
    name string
    role string
}

async func userOf(request Request) ?User {
    const name = new URL(request.url).searchParams.get("user")
    if name == null {
        return null
    }
    return { name: name, role: name == "root" ? "admin" : "user" }
}

dec session(request Request) {
    public const path = new URL(request.url).pathname
    public const user = await userOf(request)
}
`;

describe('decorators on the server', () => {
  it('may wait and defer in their bodies, and wrap what the component gives', async () => {
    expect(
      await runOnServer(`
        async func title() string {
            return "Hi"
        }
        dec layout() {
            public const heading = await title()
            defer console.log("layout closed")
            return (page Html) => <main><h1>{heading}</h1>{page}</main>
        }
        @layout
        comp Home() {
            return <p>{@layout.heading} there</p>
        }
        console.log(<Home />)
      `),
    ).toEqual(['layout closed', '<main><h1>Hi</h1><p>Hi there</p></main>']);
  });

  it('answer instead of the component with an early return, a guard', async () => {
    const handle = await handlerOf(`${SESSION}
      dec admin() needs session {
          if @session.user?.role != "admin" {
              return reply("Forbidden", { status: 403 })
          }
      }
      @admin
      comp Dashboard() {
          console.log("dashboard rendered")
          return <p>stats</p>
      }
      @session(request)
      comp App(request Request) {
          return <Dashboard />
      }
      export const handle = handler(App)
    `);
    const forbidden = await handle(get('/?user=ann'));

    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe('Forbidden');
    expect(await (await handle(get('/?user=root'))).text()).toBe('<p>stats</p>');
  });

  it('add what a guard gives to the type of the tag', () => {
    expect(
      serverErrors(`
        import { reply } from "rooklang/server"
        dec closed() {
            return reply("Closed", { status: 503 })
        }
        @closed
        comp Shop() {
            return <p>shop</p>
        }
        const page Html = <Shop />
      `),
    ).toEqual(['cannot use Html | Response as Html']);
  });

  it('check what the wrapper takes against what the component gives', () => {
    expect(
      serverErrors(`
        dec list() {
            return (names []string) => <ul>{for name in names { <li>{name}</li> }}</ul>
        }
        @list
        comp Names() {
            return <p>not a list</p>
        }
        @list
        comp Good() []string {
            return ["a"]
        }
        const page Html = <Good />
      `),
    ).toEqual([
      '@list wraps []string, but Names gives Html: apply @list to a component that gives []string',
    ]);
  });
});

describe('context: needs of a component above', () => {
  it('gives the members of a decorator to the components below that need it', async () => {
    const handle = await handlerOf(`${SESSION}
      comp Header() needs session {
          return <header>{@session.user?.name ?? "Guest"} at {@session.path}</header>
      }
      comp Logger<T>(children Content<T>) T needs session {
          defer console.log("served", @session.path)
          return await children()
      }
      comp Page() needs session {
          return <main><Header /></main>
      }
      @session(request)
      comp App(request Request) {
          return <Logger><Page /></Logger>
      }
      export const handle = handler(App)
    `);

    expect(await (await handle(get('/home?user=ann'))).text()).toBe(
      '<main><header>ann at /home</header></main>',
    );
    expect(await (await handle(get('/about'))).text()).toBe(
      '<main><header>Guest at /about</header></main>',
    );
  });

  it('is checked where a component is used by its name', () => {
    expect(
      serverErrors(`${SESSION}
        comp Header() needs session {
            return <header>{@session.path}</header>
        }
        comp Page() {
            return <main><Header /></main>
        }
        const top = <Header />
      `),
    ).toEqual([
      '<Header /> needs @session from a component above it; apply @session to Page, or add "needs session" to it',
      '<Header /> needs @session from a component above it; use it inside a component that applies @session',
    ]);
    expect(serverErrors('comp Header() needs nothing {\n    return <p />\n}')).toEqual([
      'unknown decorator @nothing',
    ]);
  });

  it('is an error of the request where a component value has no decorator above', async () => {
    const handle = await handlerOf(`${SESSION}
      comp Header() needs session {
          return <header>{@session.path}</header>
      }
      const page comp() = Header
      comp App(request Request) {
          const Page = page
          return <Page />
      }
      export const handle = handler(App)
    `);
    const logged: unknown[] = [];
    const original = console.error;

    console.error = (...args: unknown[]) => logged.push(...args);
    try {
      expect((await handle(get('/'))).status).toBe(500);
    } finally {
      console.error = original;
    }

    expect(String(logged[0])).toContain('Header needs @session from a component above it');
  });
});
