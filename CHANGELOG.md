# Changelog

**English** · [Русский](CHANGELOG.ru.md)

What changed in each version of `rooklang`: the language, the compiler, the runtime and the VS Code
extension. The road to 1.0 is in [docs/roadmap.md](docs/roadmap.md).

**Versions before 1.0.** A minor version (0.4.0) may break code that compiled before, and says how
to change it under **Breaking**. A patch version (0.3.5) never does: it adds and fixes only.

## Unreleased

### Breaking

- A public member of a decorator is read as `@visible.shown`, without `get`: `get(@visible.shown)`
  is now an error that shows the new form. Decorators are experimental, so the old form is not kept.
  Write `@visible.shown` everywhere, in markup too: `{if @visible.shown { ... }}`.

### Added

- A decorator can include others: `dec card(title string) includes framed(title), likes { ... }`
  applies them with it, above its own body, and their arguments see its parameters. The component
  reads their public members through it, `@card.count`; `@card` counts as `@likes` applied, for
  `needs` and for applying twice. An exported decorator cannot include others yet.
- `public ref` in a decorator: the component reads the element of the wrapper as `@framed.box`.
  The ref is read-only, its element is not: `@framed.box.title = "Card"`.
- A `derived` of several statements is a block that returns the value:
  `derived summary string { ...; return text }`. The type may be left out, and is then inferred
  from the `return`s. In JS the block becomes a function, called first and by the updates of what
  it reads; assigning state in it is an error. A `{` after the name of a `derived` now starts the
  block, so an object type goes in parentheses there: `derived p ({ x number }) = ...`.
- Tagged unions (experimental): comparing a tag, a field with a literal type in every member of a
  union, narrows the union. After `if d.kind == "courier"` the fields of `Courier` can be read, and
  so in `else`, after a branch that returns, in `switch d.kind` and in `{if}` and `{switch}` of
  markup. An object literal where such a union is expected is checked as the member its tag
  chooses: `{ kind: "pickup", shop: "Main st." }` fits `Pickup | Courier`, and a kind of no member
  is an error that lists the kinds.
- Paths of data fields from a variable, a parameter, `state`, `derived` or a module `const` narrow
  like the variable: `if user.boss != null` gives `user.boss.name`, without an intermediate
  `const`; `typeof` and `instanceof` narrow them too. An assignment to the path, its start or its
  tag ends the narrowing, one to another field does not; getters, `a[i]` and `?.` are not paths.
  The hint for a nullable
  `<page.other />` now shows `{if page.other != null { <page.other /> }}`.
- Keys of lists in markup: `{for todo in todos with key todo.id { ... }}` finds the blocks again
  by the key, so a list loaded again from a server keeps its blocks and the state of the
  components in them.
- The browser compiler, which the playground uses, knows `AbortController`, `AbortSignal` and
  `ImageData` as types too: `signal AbortSignal` compiles there.
- The VS Code extension checks a file with the `rooklang` installed next to it, so the editor shows
  the errors of the version that `rook build` runs; in an untrusted workspace, and without an
  installed one, it uses its own copy. The status bar shows which compiler checked the file.
- [docs/roadmap.md](docs/roadmap.md): where Rook stands and the road to 1.0, with what the
  language is to have by then.

### Fixed

- The error of `decode` for a union names the member whose tag fits: `{ "kind": "square" }` of
  `Circle | Square` gives `side: missing`, not `kind: expected "circle", got "square"`. A tag that
  fits no member lists all of them: `kind: expected "circle" | "square", got "oval"`.
- A literal type or a union of them, `type Status "shown" | "aborted"`, goes into an attribute
  without a DOM property, `data-status={status}`.
- With `runtime: "inline"`, as in the playground, a function of the program named like one of the
  runtime, such as `check`, no longer replaces it.

## 0.3.4 — 2026-10-26

### Added

- `decode<T>(json)`: checks JSON from outside against a type when the program runs.
- `try` as an expression: what JS throws becomes the error value.
- `error(msg, err)` wraps an error, as `%w` of Go.
- `signal(...)`, `done(abortSignal)` and `abortSignal(ch)`: signals of the process and cancellation
  as channels.
- Topics, `topic<T>(name)`: values between the tabs of a site.
- `for` over async iterables: streams of Node, `readline`, cursors.
- `data class`: instances that go to goroutines with their class and methods.
- Getters and setters, `readonly`, `abstract` classes, `if` with an initializer, labels, regular
  expression literals.
- Source maps: stack traces, in goroutines too, show the lines of the `.rk` file.
- `rook run --watch`: runs the program again when a file of it changes.
- Goroutines run under Vitest, which tests `.rk` modules with the Vite plugin.
- The VS Code extension completes names that other `.rk` files of the package export and adds
  their imports, and offers a quick fix that imports an undefined name.

### Fixed

- An array, a string or a `Set` goes where a `.d.ts` expects `Iterable<T>`.
- The type parameters of a tuple `[K, V]` of a `.d.ts` are inferred by position:
  `new Map([["a", 1]])` is a `Map<string, number>`.

## 0.3.3 — 2026-10-18

### Breaking

- In `const user, err = load(id)` of a function of `(User, error)`, `user` is a `?User` until
  `err` is checked: such a function may now `return null, err`. Check the error before the value,
  `if err != null { return }`.

### Changed

- `go for` splits the array into four parts per processor, each to the first free worker.
- `for i, x in items` over an array goes over its indexes instead of the pairs of `entries()`,
  which is faster.

### Fixed

- `for i, c in s` over a string numbers its characters instead of throwing a `TypeError`.
- The workers of `rook run` no longer load the compiler.

## 0.3.2 — 2026-10-17

### Breaking

- The compiled code imports its runtime from `rooklang/runtime` instead of having it in every
  module, so `rooklang` is a dependency of the project, not only of the build:
  `npm install rooklang`.

### Added

- Queues: `queue T`, made by `queue<T>()` and `queue<T>(items)`.
- Streams and channels: `chan(stream)` and `stream(ch)`.
- The VS Code extension, published from CI.

Earlier versions are in the history of the repository.
