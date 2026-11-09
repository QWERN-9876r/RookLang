# Components on the server — design

**English** · [Русский](server.ru.md)

> Status: implemented are markup as HTML, components of the server, their results, `Response`
> going up, `Content<T>`, component values with a result, decorators with guards, wrappers that
> take the body and the context through `needs`, routes, and `rooklang/server`; the server of the site, `site/server/main.rk`, is written
> with them, and the guide has a section on them. The decisions are collected at the end of the
> document, together with what is not decided yet. Every section is **experimental**: it may change
> in any release before 1.0.

> This document builds on [components.md](components.md): components, decorators, `needs`,
> components as values. It describes only what is different on the server.

## Goals

1. **A backend is a tree of components.** Middleware, a router, access checks and pages are
   components and decorators, as the views of the browser are. A request goes down the tree, and
   the value the tree gives becomes the response.
2. **Markup on the server is a string of HTML.** The same tags, attributes and checks as in the
   browser, but `<div>` gives a string, with no DOM and no updates.
3. **Not only markup.** A component of the server returns any value: HTML, a `Response`, data that
   becomes JSON. So the tree serves pages and an API alike.
4. **The language gives the means, not a framework.** Routing, sessions and access are written in
   Rook with these means, as a library; the language has none of them built in.
5. **Types along the whole way,** from the `Request` to the response, and readable JavaScript that
   runs in Node, Bun, Deno and Workers.

## Turning it on

The mode of markup is a setting of the package, as markup itself is:

```json
{ "rook": { "markup": "html" } }
```

- `"dom"` is the markup of the browser; `true`, as written now, means `"dom"`.
- `"html"` turns markup into strings of HTML and components into the components of the server
  described here.
- A server in the same repository as the browser code gets a `package.json` of its own in its
  folder, which is how a file finds its settings now (`src/config.ts`), as `site/server/` of this
  repository does. Its `"type": "module"` keeps the compiled `.js` files modules.
- The Vite plugin takes `rook({ markup: "html" })`, the browser compiler `{ markup: "html" }`. The
  CLI reads the setting of the package; its `--markup` is the markup of the browser.

## Markup as HTML

```go
const name = "Ann & Bob"
const link = <a href="/users?sort=name" class="nav">Hello, {name}</a>   // Html
```

```js
const link = $$html`<a href="/users?sort=name" class="nav">Hello, ${name}</a>`;
```

- **The type of markup is `Html`,** HTML that is known to be safe. It is a type of its own: a
  `string` is not an `Html`, nor an `Html` a `string`. In JS it is an object of the runtime whose
  `text` is the HTML, so that the runtime tells it from text too; `String(page)` and
  `` `${page}` `` give the text.
- **Attributes are checked by the DOM**, as in the browser: `<input value={1}>` and
  `<a hreff="/">` are errors. The types come from the same `lib.dom` or `src/checker/dom.ts`, only
  the result is `Html` instead of `HTMLAnchorElement`.
- **Escaping.** Text and the values of attributes are escaped; an `Html` is put in as it is. A
  string that is known to be HTML (from a Markdown renderer, say) becomes one with `html(s)`:
  `<article>{html(rendered)}</article>`. That is the only way around escaping, so a search for
  `html(` finds every place that can inject markup.
- **Children** are `Html`, strings, numbers, arrays of them and `null`, as in the browser. A
  `Response` among them stops the rendering (see "A `Response` goes up"); any other value is a
  compile error:
  `a component of type []User cannot be in markup; return it, or show its fields, e.g. {user.name}`.
- **`class={[...]}`, `bool` in ARIA attributes, SVG** work as in the browser. A `bool` attribute
  without a value, `<input disabled={off}>`, is written only when it is true.
- **`<html>` at the top of a result** gets `<!doctype html>` in front of it.
- **What the browser has and the server has not** is an error that says what to do instead:
  - `onClick` and the other handlers:
    `"onClick" has no meaning on the server: markup there is a string; make a client component with @html-tag for code that runs in the browser`;
  - `bind:`, `ref`, `state`, `derived`, `effect`, `mount`;
  - `state` at the top level of a module: on the server it would be shared by all requests at
    once. A value of the module that requests share on purpose (a cache, a pool of connections) is
    a `let` or a `const`.

## Components of the server

```go
comp UserCard(user User) {
    return <article class="user">
        <h2>{user.name}</h2>
        <p>{user.email}</p>
    </article>
}

comp UserPage(id string) {
    const user, err = await db.users.find(id)
    if err != null {
        return reply(<NotFound />, { status: 404 })
    }
    return <Layout title={user.name}><UserCard user={user} /></Layout>
}
```

- **The body runs once for each use,** from the top, as in the browser. There are no updates, so
  the choice between `return`s is simply the result.
- **A component may wait:** `await` is allowed in its body, so it loads what it shows itself. In
  JavaScript every component of the server is an `async function`; it is not marked `async` in
  Rook, since all of them are.
- **The result is any value.** Its type is inferred from the `return`s, as for a function literal,
  and may be written after the properties, as the result of a function:

  ```go
  comp Users() []User {                 // JSON for an API
      return await db.users.all()
  }

  comp Profile(user ?User) Html | Response {
      if user == null {
          return Response.redirect("/login", 303)
      }
      return <h1>{user.name}</h1>
  }
  ```

  A component that uses itself writes the type: the cycle needs it before the body is checked.
  Another module takes the type of an exported component from its module.

- **A tag of a component is its use.** `<UserCard user={user} />` gives the result of the
  component, and the tag's type is the type of that result: `Html` for `UserCard`, `[]User` for
  `Users`. The tag waits for the component by itself, so `await <UserCard />` is not written.
- **Tags side by side run at the same time.** In `<main><Header /><Feed /><Footer /></main>` the
  three components start together and the markup is joined in order once all of them end, so the
  time of the page is that of the slowest part, not the sum.
- **Properties** are checked as in the browser: types, default values, `?T` that may be left out,
  spreads, `...attrs`. They are read-only, like the properties of a browser component.

### A `Response` goes up

A component deep in the tree may decide that there is no page at all: a redirect to the login, a
404, a 403. It returns a `Response`, and when a `Response` is among the children of markup, the
rendering of the whole request stops and that `Response` is the answer:

```go
comp Layout(title string, children Content) {
    return <html>
        <head><title>{title}</title></head>
        <body>{children}</body>
    </html>
}

comp Account() needs session {
    if @session.user == null {
        return Response.redirect("/login", 303)
    }
    return <section>...</section>
}

// The redirect goes out, without the layout around it.
<Layout title="Account"><Account /></Layout>
```

- The type of `<Account />` is `Html | Response`, and markup takes it: a `Response` is a child
  that may stop the rendering. Other values are still errors.
- The components that already run side by side end, and their results are thrown away: the
  response waits for them, so that the `defer` of each one closes what it opened.
- A component that wants the `Response` of a child as a value, to look at it, takes it outside
  markup: `const page = <Account />` gives `Html | Response`, which
  `if page instanceof Response` narrows.
- **`try` lets it go up:** `const value, err = try await children()` of an error boundary catches
  errors, and a `Response` from below is not one of them, so a redirect or a 401 under the boundary
  is still the answer.

This is what `redirect()` and `notFound()` do in Next.js and Remix, but with a value instead of an
exception: the type of a component says that it may answer instead of the page.

## Children: `Content<T>`

A component that wraps others, a middleware, decides whether they run at all. So the children of a
component of the server are lazy: they are rendered only when the component asks for them.

```go
comp Logger<T>(children Content<T>) T needs session {
    const started = Date.now()
    defer console.log(`${@session.url.pathname}: ${Date.now() - started} ms`)
    return await children()
}
```

- **`Content<T>`** is a function without parameters that renders the children and gives their
  result, `T`. Calling it runs them; not calling it skips them, with all they would load.
- **`{children}` in markup** is `await children()`: the children go where it stands.
- **`Content` without an argument** is `Content<Html>`, so the components of the browser that take
  `children Content` mean the same on the server. A use without children gives `null` when they are
  called.
- **The children of `Content` are markup,** also a single component: `<Layout><Article /></Layout>`
  gives `Html`, and a `Response` of `Article` goes up when `Layout` calls them, also with
  `await children()`.
- **Type parameters of a component**, `comp Logger<T>(...)`, are new: they are written as for a
  function (see "Generics" in [spec.md](spec.md)) and are inferred from the properties and the
  children of the tag, as those of a call are from its arguments:
  `<List items={[1, 2]} render={n => String(n)} />` of
  `comp List<T>(items []T, render func(T) string)` takes `T` from `items`, and `n` is a number.
  The type of `<Logger><Users /></Logger>` is `[]User`, that of `<Logger><Profile /></Logger>` is
  `Html | Response`, that of `<Logger><p>...</p></Logger>` is `Html`. One component among the
  children of `Content<T>` gives its own value; other children are markup.
- **The children are checked** against `Content<T>` of a type: `<Names><Users /></Names>` of
  `comp Names(children Content<[]string>)` is an error,
  `the children of <Names> give []User, but it takes Content<[]string>`.
- **Calling the children twice** renders them twice; that is allowed, as for any function.

## Components as values

The type of a component value writes its result after the properties, as the type of a function
does; without it, it is `Html`:

```go
interface Route {
    page comp()                 // a page: Html
    open bool                   // no sign-in needed
}

interface Endpoint {
    run comp(id string) any     // an API: whatever it returns
}
```

A tag takes the component from a value as in the browser, `<route.page />`, and its type is the
result in the type of the value. Unlike the browser, a component value on the server does not need
the order of properties of a function at runtime: it is an `async function` of an object of
properties and the context, the same for every component.

## Decorators on the server

Decorators keep what they are in the browser: state and functions of their own, public members,
`needs`, `includes`, a wrapper. On the server their body may also wait and may answer instead of
the component.

```go
dec admin() needs session {
    if @session.user?.role != "admin" {
        return reply("Forbidden", { status: 403 })
    }
    return (page Html) => <Layout title="Admin">{page}</Layout>
}

@admin
comp Dashboard() {
    const stats = await db.stats()      // not run without access
    return <main>...</main>
}
```

- **`await`** is allowed in the body of a decorator: `public const user = await userOf(request)`.
- **An early `return` of a value** (not the function of a wrapper) is the result of the component:
  the body of the component and the bodies of the decorators below do not run, and the wrappers are
  not applied. Its type is added to the type of the component's tag: `<Dashboard />` is
  `Html | Response`. This is a guard: an access check, a limit of requests, a cache that already has
  the answer.
- **The arguments read what the component needs:** `@guard(@api.secret, request)` of
  `comp Page(request Request) needs api`. The members are taken from above before the bodies of the
  decorators run, so a guard does not have to need the context itself. Without `needs api` it is an
  error, `@api.secret in an argument comes from a component above: add "needs api" to Page`.
- **A parameter with `public`** is a member, `dec http(public request Request, public ip string)`,
  read as `@http.request`, so a context does not copy its parameters into constants.
- **The last `return`** is still the wrapper, `(page T) => U`. `T` limits where the decorator can be
  applied, as `(form HTMLFormElement) => ...` does in the browser; `U` is the result of the tag.
  The wrapper may wait, as the body does.
- **A wrapper that takes `Content<T>`** gets the body instead of what it gave: a function that runs
  the component's body, with the wrappers of the decorators below, when the wrapper calls it. So a
  decorator decides whether the body runs and catches what it throws, an error boundary written in
  Rook:

  ```go
  dec fallback(view func(Error) Html) {
      return (page Content<Html | Response>) => {
          const value, err = try await page()
          if err != null {
              return view(err)
          }
          return value
      }
  }

  @fallback((err) => <Oops message={err.message} />)
  comp Feed() { ... }
  ```

  `try` lets a `Response` from below go up, so a redirect under the boundary is still the answer.
  The bodies of the decorators run before, as always: the boundary catches the component and what
  it renders. What the component gives is checked against `T`.

- **`mount`** does not exist on the server: there is nothing to mount. The cleanup of a decorator
  is a `defer` in its body, which runs when the component ends, after its children.
- The order is that of the browser: bodies from top to bottom, wrappers from the bottom up; a
  guard of the top decorator stops the ones below it.

## Context: `needs` of a component above

The request, the user who is signed in, the connection to the database for this request: deep
components need them, and passing them through every property is what React's context and Go's
`context.Context` exist for. In Rook it is a decorator that a component above applies and the
components below name with `needs`.

```go
dec session(request Request) {
    public const url = new URL(request.url)
    public const user = await userOf(request)
}

@session(request)
comp App(request Request) {
    return <Logger><Router routes={ROUTES} /></Logger>
}

comp Header() needs session {
    return <header>{@session.user?.name ?? "Guest"}</header>
}
```

- **`needs` is written after the properties and the result** of a component, as after the
  parameters of a decorator: `comp Users() []User needs session { ... }`.
- **It is satisfied** by the decorator applied to the component itself, as now, or to any
  component above it in the tree of the request. The nearest one is taken.
- **A decorator that needs another** one, `dec admin() needs session`, is satisfied the same way:
  `@admin comp Dashboard()` takes @session from a component above when it does not apply it.
- **The component reads it** as it reads its own decorators: `@session.user`. Public state cannot be
  written from below, as now.
- **Checked at compile time** where the tree is known: a component used by its name inside a
  component that has the decorator or `needs` it. A use where it cannot be is an error:
  `<Header /> needs @session from a component above it; apply @session to Page, or add "needs session" to it`.
- **Checked at runtime** where the tree is not known: through a component value or children given
  by a component of another module. There a missing decorator is an error of the request:
  `Header needs @session from a component above it`.
- **One instance per request.** The body of `@session` runs once, where it is applied; everything
  below reads the same object. Nothing is shared between requests, unlike the state of a module.

## The entry point

The root of the tree is a component that takes the request. `rooklang/server` connects it to a
server:

```go
import { serve } from "rooklang/server"

@session(request)
comp App(request Request) {
    return <Logger><Router routes={ROUTES} /></Logger>
}

serve(App, { port: PORT })
```

- **`handler(App)`** gives a function `(request Request) => Promise<Response>`, the web standard:
  `Bun.serve({ fetch: handler(App) })`, `Deno.serve(handler(App))`,
  `export default { fetch: handler(App) }` of Workers.
- **`serve(App, { port })`** is the same for `node:http`: it turns an `IncomingMessage` into a
  `Request` and writes the `Response` back.
- **The root takes `request Request`** and may take other properties that `handler` is given:
  `handler(App, { db })`, `serve(App, { port: 3000, props: { db } })`.
- **Properties of each request** come from a function instead of an object,
  `Bun.serve({ fetch: handler(App, (request, server) => ({ ip: server.requestIP(request)?.address })) })`:
  it gets the request and what the platform gives with it, as the server of `Bun.serve` (up to two
  values: `env` and `ctx` of Workers), and may wait. Their types come from where the function of
  `handler` goes, here the `.d.ts` of Bun; elsewhere they are written,
  `(request Request, server Server)` with `import { Server } from "bun"`. `serve` gives the function
  the `IncomingMessage` of `node:http`, whose `socket` has the address of the client, and returns
  the `Server`. An error of the function is one of the request, 500.
- **The result becomes the response:**

  | The result   | The response                                 |
  | ------------ | -------------------------------------------- |
  | `Response`   | as it is                                     |
  | `Html`       | `200`, `text/html; charset=utf-8`            |
  | `string`     | `200`, `text/plain; charset=utf-8`           |
  | `null`       | `404`                                        |
  | any other    | `200`, `application/json`, `JSON.stringify`  |
  | thrown error | `500`, the error in the log, not in the body |

- **`reply(value, { status, headers })`** sets the status and the headers of any of these:
  `reply(<NotFound />, { status: 404 })`,
  `reply(user, { headers: { "Cache-Control": "no-store" } })`. It gives a `Response`; a `Response`
  given to it stays as it is.

## Routes

`route` of `rooklang/server` ties a path to a page. The parameters of the path are the properties
of the page, and the compiler checks them against each other:

```go
import { route, Route, reply } from "rooklang/server"

comp UserPage(id string) { ... }

const ROUTES []Route<Html | Response> = [
    route("/", Home),
    route("/users/:id", UserPage),
    route("/users/:uid/posts", Posts),   // error: Posts has no property "uid"
]

comp Router(routes []Route<Html | Response>) needs session {
    for each in routes {
        const Page = each.match(@session.url.pathname)
        if Page != null {
            return <Page />
        }
    }
    return reply(<NotFound />, { status: 404 })
}
```

- **The path is a string literal,** so that its parameters are known: `:id` is a segment that
  gives its text, decoded, to the property `id`.
- **Checked both ways:** each parameter is a property of the page that takes a string, and each
  property the page needs is a parameter. Errors say what to do:
  `UserPage has no property "uid" for ":uid" of "/users/:uid": rename it to ":id", or add the property`.
- **`Route<T>`** has the `path` and `match(pathname)`, which gives the page with the parameters as
  its properties, `comp() T`, or null for another path. `T` is what the page gives; `Route` alone
  is `Route<Html>`. Empty segments do not count: `/users/7/` is `/users/7`.
- **The router itself is Rook code,** a loop over a table, as the goals of this document ask: the
  order of the table is the order of the matches, and a router of a framework adds what it needs,
  the method, a prefix, nested tables.

## Example: the pieces of a framework

The router, the middleware and the access checks below are ordinary Rook code; a framework would
put such pieces into a library.

```go
import { serve, reply, route, Route } from "rooklang/server"

interface User {
    name string
    role "admin" | "user"
}

const ROUTES []Route<Html | Response> = [
    route("/", Home),
    route("/account", Account),
    route("/admin", Dashboard),
    route("/users/:id", UserPage),
]

dec session(request Request) {
    public const url = new URL(request.url)
    public const user ?User = await userOf(request)
}

@session(request)
comp App(request Request) {
    return <Logger><Router routes={ROUTES} /></Logger>
}

comp Logger<T>(children Content<T>) T needs session {
    const started = Date.now()
    defer console.log(`${@session.url.pathname}: ${Date.now() - started} ms`)
    return await children()
}

comp Router(routes []Route<Html | Response>) needs session {
    for each in routes {
        const Page = each.match(@session.url.pathname)
        if Page != null {
            return <Page />
        }
    }
    return reply(<NotFound />, { status: 404 })
}

comp Account() {
    return <Private><Profile /></Private>
}

comp Private<T>(children Content<T>) needs session {          // T | Response
    if @session.user == null {
        return Response.redirect("/login", 303)
    }
    return await children()
}

dec admin() needs session {
    if @session.user?.role != "admin" {
        return reply("Forbidden", { status: 403 })
    }
    return (page Html) => <Layout title="Admin">{page}</Layout>
}

@admin
comp Dashboard() {
    const stats = await db.stats()
    return <main><h1>Stats</h1><p>{stats.users} users</p></main>
}

serve(App, { port: PORT })
```

- `Logger` names `session` with `needs`, or it could not read the path: a component sees only what
  it asks for.
- `Router` is not special: a table of routes and `<Page />` of the one that matches; `/users/:id`
  gives `UserPage` its `id`.
- The guard is written twice, as a component (`Private`) and as a decorator (`admin`), to show both.
  A component fits a check that depends on where it is in the tree, a decorator one that belongs to
  the page itself.

## How it compiles

Every component of the server is a function of its properties and the context; markup is a template
string. The names inside are internal, as for the browser.

```go
comp Header() needs session {
    return <header>{@session.user?.name ?? "Guest"}</header>
}

comp Page(title string) {
    return <main><Header /><h1>{title}</h1><Feed /></main>
}
```

```js
async function $$Header($$props, $$ctx) {
  const { user: $$session$user } = $$need($$ctx, "session", "Header");
  return $$html`<header>${$$session$user?.name ?? "Guest"}</header>`;
}

async function $$Page({ title }, $$ctx) {
  return await $$html`<main>${$$Header({}, $$ctx)}<h1>${title}</h1>${$$Feed({}, $$ctx)}</main>`;
}
```

- **`$$html`** is a tag of the template: it escapes strings and numbers, puts `Html` in as it is,
  joins arrays, leaves out `null`, and throws an internal value with a `Response` when one is a
  child. The calls of the components among its values have all started when the template is
  evaluated, so they run side by side: the tag waits for all of them, also when one fails or gives
  a `Response`, so that the `defer` of each runs before the request ends.
- **`{for}`, `{if}` and `{switch}`** run once, in a function whose blocks push their markup into
  an array, which the template gets as a value.
- **A decorator** is inlined into the function of the component, as in the browser; a guard is a
  `return` of that function. After the bodies of its decorators, the component puts their public
  members into the context of the components it uses:
  `$$ctx = $$provide($$ctx, { session: { url: $$session$url, user: $$session$user } })`.
- **`handler`** calls the root with the properties of the request, catches the `Response` that went
  up and turns the result into a response by the table above.
- **Inlining.** A component of the server is not inlined: there are no updates to save, and a
  function per component keeps the output close to the source. A small component may be inlined
  later, if a benchmark shows that it pays.

## What the compiler has for it

- **The settings:** `markup: boolean | "html"` in `src/config.ts`, the Vite plugin and the browser
  compiler.
- **The parser:** type parameters of `comp`, the type of the result after the properties, `needs`
  after them, and `await` in the bodies of components and decorators; the type `comp(...) T`.
- **The checker:** the layers `server-markup.ts` (markup of type `Html`, what it can show, what
  waits), `server-components.ts` (the result, inferred or written, bodies checked when their result
  is first needed, `Content<T>`, the context of a use) and `server-decorators.ts` (bodies that wait,
  guards, wrappers of any value, members taken with `needs`); `server.ts` has the types of `Html`,
  `Content<T>` and `rooklang/server`.
- **The generator:** the layers `html-markup.ts` (templates of `$$html`) and `server-components.ts`
  (functions of components, their calls, the context); `src/server-context.ts` says what a
  component takes and gives, for the checker and the generator alike.
- **The runtime:** `src/runtime/html.js` (`$$safeHtml`, `$$html`, `$$attr`, `$$need`, `$$provide`) and
  `src/runtime/server.js`, exported as `rooklang/server` (`handler`, `serve`, `reply`, `html`).

## Stages

1. ~~**Markup as HTML** and components as async functions that return `Html`; the errors for what
   the server has not.~~ Done.
2. ~~**The result `T`**, `Response` going up, `handler`, `serve` and `reply`.~~ Done.
3. ~~**`Content<T>`** and type parameters of components; component values with a result.~~ Done.
4. ~~**Decorators on the server:** `await`, guards, context through `needs`.~~ Done.
5. ~~**The site:** `site/server.rk` written with components, a section of the guide and an
   example, in both languages; highlighting of `comp X<T>() T needs a`.~~ Done: the server is
   `site/server/main.rk`, the section "Components on the server". A program of the site that
   imports `rooklang/server` is compiled with markup as HTML, the setting of a package that the
   page has not; it does not run on the page yet.

## Decisions

1. **The mode is a setting of the package,** `"rook": { "markup": "html" }`, not a keyword or a
   name of a file: a file is either for the browser or for the server, and the setting already
   finds its package.
2. **A component of the server returns any value,** inferred or written after the properties: an
   API and pages are the same tree.
3. **A `Response` among children goes up** and becomes the answer, so a guard can stand at any
   depth without passing anything up by hand.
4. **Children are lazy, `Content<T>`,** and a wrapper is generic: a middleware does not run what it
   does not let through, and its type is that of what it wraps.
5. **Context is a decorator of a component above, named with `needs`:** explicit, typed, one
   instance per request, and no new concept besides what decorators are.
6. **A guard is an early `return` in the body of a decorator.**
7. **The entry is `serve(App)` and `handler(App)` of `rooklang/server`,** on the web standard
   `Request` and `Response`, so one server runs in Node, Bun, Deno and Workers.
8. **An error boundary is a wrapper that takes `Content<T>`,** not a decorator of the language:
   the wrapper gets the body to run, and `@fallback` is a few lines of Rook.
9. **Routes are `route("/users/:id", UserPage)`,** a function whose literal path the compiler
   checks against the properties of the page; the router stays Rook code.

## Not decided yet

1. **Streaming HTML.** The head of a page could go out before the slow parts are ready, with a
   `ReadableStream`; then a `Response` from below would come too late for the status. Perhaps a
   decorator, `@stream`, that says a page may be sent in parts.
2. **Islands.** A component of the browser made with `@html-tag` is a custom element, so the server
   can put `<app-counter count={3}>` into its HTML and a script of the browser bundle brings it to
   life. What is missing is how the server knows which scripts a page needs.
3. **The CSS of `style`.** A component of the server with `style` could add its CSS once per
   response, into `<head>`; until then `style` is an error on the server.
4. **One component for both modes.** A component without state, handlers and refs could be compiled
   both to DOM and to HTML, so that a page and its client share the markup.
5. **A decorator of a cache,** `@cache("60s")`, that answers from memory before the body runs (a
   guard) and keeps the result after it (a wrapper).
6. **Whether a component of the server is marked `async`.** Now it is not: all of them are. The
   order `comp X() T needs a` is open as well.
7. **A flag of the CLI for markup as HTML,** as `--markup` is for that of the browser; now the CLI
   takes it from the package.
