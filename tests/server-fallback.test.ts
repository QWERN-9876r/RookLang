import { describe, expect, it } from 'vitest';
import { get, handlerOf, runOnServer, serverErrors, serverJs } from './server.ts';

// A wrapper of a decorator that takes `Content<T>` gets the body of the component as a function
// and decides when it runs: so a decorator catches what the body throws, an error boundary
// (docs/server.md, "Decorators on the server").

const FALLBACK = `
dec fallback(view func(Error) Html) {
    return (page Content<Html | Response>) => {
        const value, err = try await page()
        if err != null {
            return view(err)
        }
        return value
    }
}
`;

describe('a wrapper that takes the body', () => {
  it('runs the body when it calls it, and catches what it throws', async () => {
    expect(
      await runOnServer(`${FALLBACK}
        dec layout() {
            return (page Html) => <main>{page}</main>
        }
        @fallback((err) => <p>Oops: {err.message}</p>)
        @layout
        comp Feed(fail bool) {
            defer console.log("feed closed")
            if fail {
                throw new Error("no feed")
            }
            return <ul />
        }
        console.log(<Feed fail={false} />)
        console.log(<Feed fail={true} />)
      `),
    ).toEqual(['feed closed', '<main><ul></ul></main>', 'feed closed', '<p>Oops: no feed</p>']);
  });

  it('lets a Response from below go up through try', async () => {
    const handle = await handlerOf(`
      import { handler } from "rooklang/server"
      ${FALLBACK}
      comp Login() {
          return Response.redirect("http://localhost/login", 303)
      }
      comp Broken() Html {
          throw new Error("broken")
      }
      @fallback((err) => <p>Oops</p>)
      comp App(request Request) {
          if new URL(request.url).pathname == "/broken" {
              return <div><Broken /></div>
          }
          return <div><Login /></div>
      }
      export const handle = handler(App)
    `);

    expect((await handle(get('/'))).status).toBe(303);
    expect(await (await handle(get('/broken'))).text()).toBe('<p>Oops</p>');
  });

  it('may skip the body', async () => {
    expect(
      await runOnServer(`
        dec closed() {
            return (page Content) => <p>closed</p>
        }
        @closed
        comp Shop() {
            console.log("not run")
            return <ul />
        }
        console.log(<Shop />)
      `),
    ).toEqual(['<p>closed</p>']);
  });

  it('writes the body as an async function in the component', () => {
    const code = serverJs(`${FALLBACK}
      @fallback((err) => <p>Oops</p>)
      comp Feed() {
          return <ul />
      }`);

    expect(code).toContain('const $$fallback$page = async () => {');
    expect(code).toContain('await $$fallback$page()');
  });

  it('checks what the component gives against the T of Content<T>', () => {
    expect(
      serverErrors(`
        dec html() {
            return (page Content<Html>) => page()
        }
        @html
        comp Users() string[] {
            return ["a"]
        }`),
    ).toEqual([
      '@html wraps Html, but Users gives string[]: apply @html to a component that gives Html',
    ]);
  });

  it('allows await only in the wrapper itself, not in other functions of a return', () => {
    expect(
      serverErrors(`
        func later(f func() Html) Html {
            return f()
        }
        dec guard() {
            return later(() => await Promise.resolve(<p />))
        }`),
    ).toContain(
      '"await" is allowed only in async functions and at the top level of a module; mark the function, e.g. "async func load() { ... }"',
    );
  });
});
