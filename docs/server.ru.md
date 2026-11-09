# Компоненты на сервере — концепция

[English](server.md) · **Русский**

> Статус: реализованы разметка как HTML, серверные компоненты, их результаты, всплытие `Response`,
> `Content<T>`, компоненты-значения с результатом, декораторы с guard, обёртками, которые получают
> тело, и контекстом через `needs`, маршруты, а также `rooklang/server`; на них написан сервер сайта, `site/server/main.rk`, и о них есть раздел
> гайда. Решения собраны в конце документа, там же — то, что ещё не решено. Каждый раздел
> **экспериментальный**: он может измениться в любом релизе до 1.0.

> Документ опирается на [components.ru.md](components.ru.md): компоненты, декораторы, `needs`,
> компоненты как значения. Здесь описано только то, что на сервере иначе.

## Цели

1. **Бэкенд — это дерево компонентов.** Middleware, роутер, проверки доступа и страницы — это
   компоненты и декораторы, как и интерфейс в браузере. Запрос идёт вниз по дереву, а значение,
   которое дерево отдаёт, становится ответом.
2. **Разметка на сервере — строка HTML.** Те же теги, атрибуты и проверки, что в браузере, но
   `<div>` даёт строку: без DOM и без обновлений.
3. **Не только разметка.** Серверный компонент возвращает любое значение: HTML, `Response`,
   данные, которые станут JSON. Поэтому одно дерево отдаёт и страницы, и API.
4. **Язык даёт средства, а не фреймворк.** Роутинг, сессии и доступ пишутся на Rook этими
   средствами, как библиотека; в сам язык ничего из этого не встроено.
5. **Типы на всём пути,** от `Request` до ответа, и читаемый JavaScript, который работает в Node,
   Bun, Deno и Workers.

## Как включить

Режим разметки — настройка пакета, как и сама разметка:

```json
{ "rook": { "markup": "html" } }
```

- `"dom"` — разметка браузера; нынешнее `true` значит `"dom"`.
- `"html"` превращает разметку в строки HTML, а компоненты — в серверные компоненты, описанные
  здесь.
- Сервер в одном репозитории с браузерным кодом получает свой `package.json` в своей папке: так
  файл уже сейчас находит свои настройки (`src/config.ts`), так сделан и `site/server/` этого
  репозитория. Его `"type": "module"` оставляет скомпилированные файлы `.js` модулями.
- Плагин Vite принимает `rook({ markup: "html" })`, браузерный компилятор — `{ markup: "html" }`.
  CLI читает настройку пакета; его `--markup` — разметка браузера.

## Разметка как HTML

```go
const name = "Ann & Bob"
const link = <a href="/users?sort=name" class="nav">Hello, {name}</a>   // Html
```

```js
const link = $$html`<a href="/users?sort=name" class="nav">Hello, ${name}</a>`;
```

- **Тип разметки — `Html`,** HTML, про который известно, что он безопасен. Это отдельный тип:
  `string` не является `Html`, а `Html` — `string`. В JS это объект рантайма, чей `text` — HTML,
  чтобы рантайм тоже отличал его от текста; `String(page)` и `` `${page}` `` дают текст.
- **Атрибуты проверяются по DOM**, как в браузере: `<input value={1}>` и `<a hreff="/">` — ошибки.
  Типы берутся из того же `lib.dom` или `src/checker/dom.ts`, только результат — `Html`, а не
  `HTMLAnchorElement`.
- **Экранирование.** Текст и значения атрибутов экранируются; `Html` вставляется как есть. Строка,
  про которую известно, что это HTML (например, из рендерера Markdown), становится им через
  `html(s)`: `<article>{html(rendered)}</article>`. Других способов обойти экранирование нет, так
  что поиск по `html(` находит все места, где можно внедрить разметку.
- **Дети** — `Html`, строки, числа, массивы из них и `null`, как в браузере. `Response` среди них
  останавливает рендер (см. «`Response` всплывает»); любое другое значение — ошибка компиляции:
  `a component of type User[] cannot be in markup; return it, or show its fields, e.g. {user.name}`.
- **`class={[...]}`, `bool` в ARIA-атрибутах, SVG** работают как в браузере. Атрибут `bool` без
  значения, `<input disabled={off}>`, пишется, только когда он истинен.
- **`<html>` в начале результата** получает перед собой `<!doctype html>`.
- **То, что есть в браузере, но нет на сервере,** — ошибка, которая говорит, что сделать вместо
  этого:
  - `onClick` и другие обработчики:
    `"onClick" has no meaning on the server: markup there is a string; make a client component with @html-tag for code that runs in the browser`;
  - `bind:`, `ref`, `state`, `derived`, `effect`, `mount`;
  - `state` на верхнем уровне модуля: на сервере оно было бы общим для всех запросов сразу.
    Значение модуля, которое запросы делят намеренно (кэш, пул соединений), — это `let` или
    `const`.

## Серверные компоненты

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

- **Тело выполняется один раз на каждое использование,** сверху вниз, как в браузере. Обновлений
  нет, поэтому выбор между `return` — это просто результат.
- **Компонент может ждать:** в его теле разрешён `await`, так что он сам загружает то, что
  показывает. В JavaScript каждый серверный компонент — `async function`; в Rook он не помечается
  `async`, потому что асинхронны все.
- **Результат — любое значение.** Его тип выводится из `return`, как у литерала функции, и его можно
  написать после свойств, как результат функции:

  ```go
  comp Users() User[] {                 // JSON for an API
      return await db.users.all()
  }

  comp Profile(user ?User) Html | Response {
      if user == null {
          return Response.redirect("/login", 303)
      }
      return <h1>{user.name}</h1>
  }
  ```

  Компонент, который использует сам себя, пишет тип: циклу он нужен раньше, чем проверено тело.
  Другой модуль берёт тип экспортируемого компонента из его модуля.

- **Тег компонента — его использование.** `<UserCard user={user} />` даёт результат компонента, и
  тип тега — тип этого результата: `Html` у `UserCard`, `User[]` у `Users`. Тег сам ждёт
  компонент, поэтому `await <UserCard />` не пишется.
- **Соседние теги выполняются одновременно.** В `<main><Header /><Feed /><Footer /></main>` три
  компонента стартуют вместе, а разметка собирается по порядку, когда все закончат. Время страницы —
  время самой медленной части, а не сумма.
- **Свойства** проверяются как в браузере: типы, значения по умолчанию, `?T`, которое можно
  опустить, spread, `...attrs`. Они только для чтения, как свойства браузерного компонента.

### `Response` всплывает

Компонент глубоко в дереве может решить, что страницы нет вовсе: редирект на вход, 404, 403. Он
возвращает `Response`, и когда `Response` оказывается среди детей разметки, рендер всего запроса
останавливается и ответом становится этот `Response`:

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

- Тип `<Account />` — `Html | Response`, и разметка его принимает: `Response` — это ребёнок,
  который может остановить рендер. Другие значения по-прежнему ошибки.
- Компоненты, которые уже выполняются рядом, доходят до конца, а их результаты отбрасываются: ответ
  ждёт их, чтобы `defer` каждого закрыл то, что он открыл.
- Компонент, которому нужен `Response` ребёнка как значение, чтобы посмотреть на него, берёт его вне
  разметки: `const page = <Account />` даёт `Html | Response`, а `if page instanceof Response`
  сужает тип.
- **`try` пропускает его наверх:** `const value, err = try await children()` границы ошибок ловит
  ошибки, а `Response` снизу — не ошибка, поэтому редирект или 401 под границей остаётся ответом.

Так работают `redirect()` и `notFound()` в Next.js и Remix, но через значение, а не исключение:
тип компонента говорит, что он может ответить вместо страницы.

## Дети: `Content<T>`

Компонент, который оборачивает другие (middleware), решает, выполнять ли их вообще. Поэтому дети
серверного компонента ленивые: они рендерятся, только когда компонент их попросит.

```go
comp Logger<T>(children Content<T>) T needs session {
    const started = Date.now()
    defer console.log(`${@session.url.pathname}: ${Date.now() - started} ms`)
    return await children()
}
```

- **`Content<T>`** — функция без параметров, которая рендерит детей и отдаёт их результат, `T`.
  Вызов запускает их; без вызова они пропускаются вместе со всем, что загрузили бы.
- **`{children}` в разметке** — это `await children()`: дети встают туда, где оно стоит.
- **`Content` без аргумента** — это `Content<Html>`, поэтому браузерные компоненты с
  `children Content` значат на сервере то же самое. Если у тега нет детей, их вызов даёт `null`.
- **Дети `Content` — разметка,** даже один компонент: `<Layout><Article /></Layout>` даёт `Html`, а
  `Response` компонента `Article` всплывает, когда `Layout` вызывает детей, в том числе через
  `await children()`.
- **Параметры типа у компонента**, `comp Logger<T>(...)`, — новая конструкция: они пишутся как у
  функции (см. «Generics» в [spec.ru.md](spec.ru.md)) и выводятся из свойств и детей тега, как у
  вызова из аргументов: `<List items={[1, 2]} render={n => String(n)} />` для
  `comp List<T>(items T[], render func(T) string)` берёт `T` из `items`, а `n` — число. Тип
  `<Logger><Users /></Logger>` — `User[]`, `<Logger><Profile /></Logger>` — `Html | Response`,
  `<Logger><p>...</p></Logger>` — `Html`. Один компонент среди детей `Content<T>` даёт своё
  значение, остальные дети — разметка.
- **Дети проверяются** по `Content<T>` типа: `<Names><Users /></Names>` для
  `comp Names(children Content<string[]>)` — ошибка
  `the children of <Names> give User[], but it takes Content<string[]>`.
- **Вызвать детей дважды** — значит отрендерить их дважды; это разрешено, как для любой функции.

## Компоненты как значения

Тип компонента-значения пишет результат после свойств, как тип функции; без него результат —
`Html`:

```go
interface Route {
    page comp()                 // a page: Html
    open bool                   // no sign-in needed
}

interface Endpoint {
    run comp(id string) any     // an API: whatever it returns
}
```

Тег берёт компонент из значения как в браузере, `<route.page />`, и его тип — результат из типа
значения. В отличие от браузера, серверному компоненту-значению не нужен порядок свойств функции в
рантайме: это `async function` от объекта свойств и контекста, одна форма для всех компонентов.

## Декораторы на сервере

Декораторы остаются тем же, чем были в браузере: своё состояние и функции, публичные члены,
`needs`, `includes`, обёртка. На сервере их тело ещё и может ждать и может ответить вместо
компонента.

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

- **`await`** разрешён в теле декоратора: `public const user = await userOf(request)`.
- **Ранний `return` значения** (не функции обёртки) — это результат компонента: тело компонента и
  тела нижних декораторов не выполняются, обёртки не применяются. Его тип добавляется к типу тега
  компонента: `<Dashboard />` — это `Html | Response`. Это guard: проверка доступа, лимит запросов,
  кэш, у которого уже есть ответ.
- **Аргументы читают то, что нужно компоненту:** `@guard(@api.secret, request)` у
  `comp Page(request Request) needs api`. Члены берутся сверху до того, как выполнятся тела
  декораторов, поэтому гарду не нужен `needs` самому. Без `needs api` это ошибка
  `@api.secret in an argument comes from a component above: add "needs api" to Page`.
- **Параметр с `public`** — член декоратора, `dec http(public request Request, public ip string)`,
  его читают как `@http.request`, так что контекст не копирует параметры в константы.
- **Последний `return`** по-прежнему обёртка, `(page T) => U`. `T` ограничивает, где декоратор можно
  применить, как `(form HTMLFormElement) => ...` в браузере; `U` — результат тега. Обёртка может
  ждать, как и тело.
- **Обёртка, которая принимает `Content<T>`,** получает не то, что дало тело, а само тело: функцию,
  которая выполняет тело компонента с обёртками нижних декораторов, когда обёртка её вызовет. Так
  декоратор решает, выполнять ли тело, и ловит то, что оно бросило, — error boundary, написанный на
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

  `try` пропускает всплывающий снизу `Response`, так что редирект под границей по-прежнему ответ.
  Тела декораторов, как всегда, выполняются раньше: граница ловит компонент и то, что он рисует. То,
  что даёт компонент, проверяется по `T`.

- **`mount`** на сервере нет: монтировать нечего. Очистка декоратора — `defer` в его теле, который
  выполняется, когда компонент закончит, после его детей.
- Порядок тот же, что в браузере: тела сверху вниз, обёртки снизу вверх; guard верхнего декоратора
  останавливает нижние.

## Контекст: `needs` компонента выше

Запрос, вошедший пользователь, соединение с базой для этого запроса — это нужно глубоким
компонентам, а протаскивать это через каждое свойство — то, ради чего существуют контекст React и
`context.Context` в Go. В Rook это декоратор, который применяет компонент выше, а компоненты ниже
называют через `needs`.

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

- **`needs` пишется после свойств и результата** компонента, как после параметров декоратора:
  `comp Users() User[] needs session { ... }`.
- **Он выполнен,** если декоратор применён к самому компоненту, как сейчас, или к любому компоненту
  выше него в дереве запроса. Берётся ближайший.
- **Декоратор, которому нужен другой**, `dec admin() needs session`, выполняется так же:
  `@admin comp Dashboard()` берёт @session у компонента выше, если не применяет его сам.
- **Компонент читает его** так же, как свои декораторы: `@session.user`. Публичное состояние нельзя
  менять снизу, как и сейчас.
- **Проверяется при компиляции** там, где дерево известно: компонент, использованный по имени
  внутри компонента, у которого есть этот декоратор или `needs` его. Использование там, где его нет,
  — ошибка:
  `<Header /> needs @session from a component above it; apply @session to Page, or add "needs session" to it`.
- **Проверяется в рантайме** там, где дерево неизвестно: через компонент-значение или детей,
  переданных компонентом другого модуля. Там отсутствующий декоратор — ошибка запроса:
  `Header needs @session from a component above it`.
- **Один экземпляр на запрос.** Тело `@session` выполняется один раз, там, где он применён; всё ниже
  читает тот же объект. Между запросами ничего не делится, в отличие от состояния модуля.

## Точка входа

Корень дерева — компонент, который принимает запрос. `rooklang/server` подключает его к серверу:

```go
import { serve } from "rooklang/server"

@session(request)
comp App(request Request) {
    return <Logger><Router routes={ROUTES} /></Logger>
}

serve(App, { port: PORT })
```

- **`handler(App)`** даёт функцию `(request Request) => Promise<Response>` по веб-стандарту:
  `Bun.serve({ fetch: handler(App) })`, `Deno.serve(handler(App))`,
  `export default { fetch: handler(App) }` в Workers.
- **`serve(App, { port })`** — то же для `node:http`: превращает `IncomingMessage` в `Request` и
  записывает `Response` обратно.
- **Корень принимает `request Request`** и может принимать другие свойства, которые передали
  `handler`: `handler(App, { db })`, `serve(App, { port: 3000, props: { db } })`.
- **Свойства каждого запроса** даёт функция вместо объекта,
  `Bun.serve({ fetch: handler(App, (request, server) => ({ ip: server.requestIP(request)?.address })) })`:
  она получает запрос и то, что платформа передаёт вместе с ним, как сервер `Bun.serve` (до двух
  значений: `env` и `ctx` у Workers), и может ждать. Их типы приходят из места, куда идёт функция
  `handler`, здесь из `.d.ts` Bun; в других местах их пишут, `(request Request, server Server)` с
  `import { Server } from "bun"`. `serve` передаёт функции `IncomingMessage` из `node:http`, у
  которого в `socket` адрес клиента, и возвращает `Server`. Ошибка функции — ошибка запроса, 500.
- **Результат становится ответом:**

  | Результат        | Ответ                                       |
  | ---------------- | ------------------------------------------- |
  | `Response`       | как есть                                    |
  | `Html`           | `200`, `text/html; charset=utf-8`           |
  | `string`         | `200`, `text/plain; charset=utf-8`          |
  | `null`           | `404`                                       |
  | любое другое     | `200`, `application/json`, `JSON.stringify` |
  | брошенная ошибка | `500`, ошибка в логе, а не в теле ответа    |

- **`reply(value, { status, headers })`** задаёт статус и заголовки любому из них:
  `reply(<NotFound />, { status: 404 })`,
  `reply(user, { headers: { "Cache-Control": "no-store" } })`. Результат — `Response`; переданный
  `Response` остаётся как есть.

## Маршруты

`route` из `rooklang/server` связывает путь со страницей. Параметры пути — свойства страницы, и
компилятор сверяет их друг с другом:

```go
import { route, Route, reply } from "rooklang/server"

comp UserPage(id string) { ... }

const ROUTES Route<Html | Response>[] = [
    route("/", Home),
    route("/users/:id", UserPage),
    route("/users/:uid/posts", Posts),   // ошибка: у Posts нет свойства "uid"
]

comp Router(routes Route<Html | Response>[]) needs session {
    for each in routes {
        const Page = each.match(@session.url.pathname)
        if Page != null {
            return <Page />
        }
    }
    return reply(<NotFound />, { status: 404 })
}
```

- **Путь — строковый литерал,** чтобы его параметры были известны: `:id` — сегмент, который отдаёт
  свой текст, декодированный, свойству `id`.
- **Проверка в обе стороны:** каждый параметр — свойство страницы, принимающее строку, и каждое
  нужное странице свойство — параметр. Ошибки говорят, что делать:
  `UserPage has no property "uid" for ":uid" of "/users/:uid": rename it to ":id", or add the property`.
- **`Route<T>`** — это `path` и `match(pathname)`, который даёт страницу с параметрами в свойствах,
  `comp() T`, или null для другого пути. `T` — то, что даёт страница; `Route` без аргумента — это
  `Route<Html>`. Пустые сегменты не считаются: `/users/7/` — это `/users/7`.
- **Сам роутер — код на Rook,** цикл по таблице, как и просят цели этого документа: порядок таблицы
  — порядок сопоставления, а роутер фреймворка добавит, что ему нужно: метод, префикс, вложенные
  таблицы.

## Пример: части фреймворка

Роутер, middleware и проверки доступа ниже — обычный код на Rook; фреймворк сложил бы такие части
в библиотеку.

```go
import { serve, reply, route, Route } from "rooklang/server"

interface User {
    name string
    role "admin" | "user"
}

const ROUTES Route<Html | Response>[] = [
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

comp Router(routes Route<Html | Response>[]) needs session {
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

- `Logger` называет `session` через `needs`, иначе он не смог бы прочитать путь: компонент видит
  только то, что попросил.
- `Router` ничем не особенный: таблица маршрутов и `<Page />` того, что подошёл; `/users/:id` даёт
  `UserPage` его `id`.
- Guard написан дважды, компонентом (`Private`) и декоратором (`admin`), чтобы показать оба способа.
  Компонент подходит для проверки, которая зависит от места в дереве, декоратор — для той, что
  принадлежит самой странице.

## Как это компилируется

Каждый серверный компонент — функция от своих свойств и контекста; разметка — шаблонная строка.
Имена внутри служебные, как в браузере.

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

- **`$$html`** — тег шаблона: экранирует строки и числа, вставляет `Html` как есть, склеивает
  массивы, пропускает `null` и бросает внутреннее значение с `Response`, когда тот оказался
  ребёнком. Вызовы компонентов среди его значений начались, когда шаблон вычислялся, поэтому они
  выполняются одновременно: тег ждёт их все, и когда один упал или дал `Response`, чтобы `defer`
  каждого выполнился до конца запроса.
- **`{for}`, `{if}` и `{switch}`** выполняются один раз, в функции, чьи блоки кладут свою разметку
  в массив, а шаблон получает его как значение.
- **Декоратор** встраивается в функцию компонента, как в браузере; guard — это `return` этой
  функции. После тел своих декораторов компонент кладёт их публичные члены в контекст компонентов,
  которые использует:
  `$$ctx = $$provide($$ctx, { session: { url: $$session$url, user: $$session$user } })`.
- **`handler`** вызывает корень со свойствами запроса, ловит всплывший `Response` и превращает
  результат в ответ по таблице выше.
- **Встраивание.** Серверный компонент не встраивается: экономить на обновлениях нечего, а функция
  на компонент держит вывод близко к исходнику. Маленький компонент можно будет встраивать позже,
  если бенчмарк покажет, что это окупается.

## Что для этого есть в компиляторе

- **Настройки:** `markup: boolean | "html"` в `src/config.ts`, плагине Vite и браузерном
  компиляторе.
- **Парсер:** параметры типа у `comp`, тип результата после свойств, `needs` после них и `await` в
  телах компонентов и декораторов; тип `comp(...) T`.
- **Проверка типов:** слои `server-markup.ts` (разметка типа `Html`, что она может показать, что
  ждёт), `server-components.ts` (результат, выведенный или написанный, тела, которые проверяются,
  когда их результат нужен впервые, `Content<T>`, контекст использования) и `server-decorators.ts`
  (тела, которые ждут, guard, обёртки любого значения, члены, взятые через `needs`); в `server.ts` —
  типы `Html`, `Content<T>` и `rooklang/server`.
- **Генератор:** слои `html-markup.ts` (шаблоны `$$html`) и `server-components.ts` (функции
  компонентов, их вызовы, контекст); `src/server-context.ts` говорит, что компонент берёт и отдаёт,
  одинаково для проверки типов и генератора.
- **Рантайм:** `src/runtime/html.js` (`$$safeHtml`, `$$html`, `$$attr`, `$$need`, `$$provide`) и
  `src/runtime/server.js`, экспортированный как `rooklang/server` (`handler`, `serve`, `reply`,
  `html`).

## Этапы

1. ~~**Разметка как HTML** и компоненты — асинхронные функции, которые возвращают `Html`; ошибки
   для того, чего на сервере нет.~~ Сделано.
2. ~~**Результат `T`**, всплытие `Response`, `handler`, `serve` и `reply`.~~ Сделано.
3. ~~**`Content<T>`** и параметры типа у компонентов; компоненты-значения с результатом.~~ Сделано.
4. ~~**Декораторы на сервере:** `await`, guard, контекст через `needs`.~~ Сделано.
5. ~~**Сайт:** `site/server.rk` на компонентах, раздел гайда и пример, на обоих языках; подсветка
   `comp X<T>() T needs a`.~~ Сделано: сервер — `site/server/main.rk`, раздел — «Компоненты на
   сервере». Программа сайта, которая импортирует `rooklang/server`, компилируется с разметкой как
   HTML — настройкой пакета, которого у страницы нет; на странице она пока не запускается.

## Решения

1. **Режим — настройка пакета,** `"rook": { "markup": "html" }`, а не ключевое слово и не имя файла:
   файл либо для браузера, либо для сервера, а настройка уже умеет находить свой пакет.
2. **Серверный компонент возвращает любое значение,** выведенное или написанное после свойств: API
   и страницы — одно дерево.
3. **`Response` среди детей всплывает** и становится ответом, поэтому guard может стоять на любой
   глубине, и ничего не надо пробрасывать вверх вручную.
4. **Дети ленивые, `Content<T>`,** а обёртка обобщённая: middleware не выполняет то, что не
   пропустил, а его тип — тип того, что он оборачивает.
5. **Контекст — декоратор компонента выше, названный через `needs`:** явно, с типами, один
   экземпляр на запрос и без новых понятий, кроме того, чем уже являются декораторы.
6. **Guard — ранний `return` в теле декоратора.**
7. **Вход — `serve(App)` и `handler(App)` из `rooklang/server`,** на веб-стандартных `Request` и
   `Response`, так что один сервер работает в Node, Bun, Deno и Workers.
8. **Граница ошибок — обёртка, которая принимает `Content<T>`,** а не декоратор языка: обёртка
   получает тело, чтобы выполнить его, и `@fallback` — несколько строк на Rook.
9. **Маршруты — `route("/users/:id", UserPage)`,** функция, литеральный путь которой компилятор
   проверяет по свойствам страницы; роутер остаётся кодом на Rook.

## Ещё не решено

1. **Стриминг HTML.** Начало страницы могло бы уходить раньше, чем готовы медленные части, через
   `ReadableStream`; тогда `Response` снизу пришёл бы слишком поздно для статуса. Возможно,
   декоратор `@stream`, который говорит, что страницу можно отправлять частями.
2. **Острова.** Браузерный компонент с `@html-tag` — это custom element, поэтому сервер может
   вставить `<app-counter count={3}>` в свой HTML, а скрипт браузерного бандла его оживит. Не хватает
   того, как сервер узнаёт, какие скрипты нужны странице.
3. **CSS из `style`.** Серверный компонент со `style` мог бы добавлять свой CSS один раз за ответ, в
   `<head>`; пока `style` на сервере — ошибка.
4. **Один компонент для обоих режимов.** Компонент без состояния, обработчиков и ref можно было бы
   компилировать и в DOM, и в HTML, чтобы страница и её клиент делили разметку.
5. **Декоратор кэша,** `@cache("60s")`, который отвечает из памяти до выполнения тела (guard) и
   сохраняет результат после него (обёртка).
6. **Помечать ли серверный компонент `async`.** Сейчас нет: асинхронны все. Порядок
   `comp X() T needs a` тоже открыт.
7. **Флаг CLI для разметки как HTML,** как `--markup` для разметки браузера; сейчас CLI берёт её из
   пакета.
