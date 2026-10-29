# Rook — the road to 1.0

**English** · [Русский](roadmap.ru.md)

Rook is at 0.x: the language works, the site is written in it, but the specification is a draft
and may still change. The goal is **1.0: a language to use in production**, with a stable core and
the tools a team expects. This file says where Rook stands, what is missing and in what order it
will come. The same plan is on the site: <https://qwern-9876r.github.io/RookLang/roadmap/>.

## Where Rook is going

Rook does not try to be a wider TypeScript. Its place is **real threads in the browser and in Node,
checked by the compiler, and UI without a framework, in a language that compiles to readable
JavaScript you can keep.** Each phase below makes that place stronger.

**New syntax comes from the list "The language for 1.0" below,** each piece as the maintainer
decides it. Other ideas go to "Not in v0" of the [specification](spec.md) and wait for 1.0.

## Rook today

### What is already there

| Concern                                            | How it is                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goroutines are an emulation on the event loop      | `go f(x)` runs `f` on another thread, a Web Worker or a Node worker thread. Inside a thread, channels and `select` work on its event loop, as `async` code does.                                        |
| Data races, as in Go                               | What goes to another thread is copied (`structuredClone`) or moved with `transfer(x)`, and the compiler checks that it can be. Memory is shared only through a `SharedArrayBuffer` made for it.         |
| The runtime makes the bundle bigger                | A module imports only the functions of `rooklang/runtime` its code uses; a program without channels, goroutines or markup imports none. All of the runtime is about 19 KB gzipped, before minification. |
| There are no libraries                             | Rook imports any JS module and takes the types from TypeScript declarations (`.d.ts`, `@types/*`): the libraries of Rook are those of npm.                                                              |
| A Rook component cannot go into a React or Vue app | `@html-tag` makes a component a web component, a custom element that React, Vue, Svelte and plain HTML use as any other.                                                                                |
| TypeScript code cannot use Rook modules            | `rook build` writes a `.d.ts` next to each `.js`.                                                                                                                                                       |
| Debugging is blind                                 | Source maps: stack traces, in goroutines too, and debuggers show the lines of the `.rk` file.                                                                                                           |
| Builds and tests                                   | The Vite plugin `rooklang/vite`; Vitest runs Rook code, goroutines included.                                                                                                                            |

### What is not there yet

- **Stability.** The specification marks its experimental sections, but the compiler does not warn
  of deprecated forms yet.
- **The editor.** The VS Code extension shows errors as you type, completes and has quick fixes,
  but has no hover, go to definition, references, rename or outline.
- **The command line.** `rook build` and `rook run`; no formatter, no `check` for CI, no template
  of a project.
- **Debugging goroutines.** A deadlock is not reported, a goroutine left waiting is not shown, and
  the workers in DevTools have no names.
- **Numbers.** There are no benchmarks of channels and goroutines against plain JS, and none in CI.
- **TypeScript under Vite.** The Vite plugin does not write `.d.ts`, so a `.ts` file that imports a
  `.rk` module there sees `any`.
- **Comments in the output.** The generated JS keeps the names and the structure of the source, but
  not its comments.

### Not locked in

Rook compiles to readable JavaScript with the same names and structure. A project can build its
`.rk` files once with `rook build` and go on in JS. What stays is the `rooklang/runtime` import of
the code that uses channels, goroutines or markup: plain JS under the MIT license, which can be kept
as a dependency or copied into the project. This is a promise of the language, and the guide shows
how (the section "Rook in an existing project").

## The road to 1.0

### Phase 0 — say what is there _(done)_

- This roadmap, here and on the site.
- A section of the guide on using Rook in an existing project: a `.rk` module in a Vite project, a
  Rook component in a React app, and leaving Rook with the generated JS.

### Phase 1 — stability _(in progress)_

- [CHANGELOG.md](../CHANGELOG.md). In 0.x a minor version may break code, a patch version never
  does. _(done)_
- Every section of the specification is marked **stable** or **experimental**. Experimental
  features may change in any release; stable ones only through deprecation. _(done)_
- Deprecation: the old form keeps working for at least one minor version with a warning that shows
  the new form, then it is removed.
- Snapshots of the generated code for the examples of the site and of `examples/`, so that every
  change of the output shows in the diff. _(done: `tests/output/`)_
- Comments of the source in the generated code, so that the JS a project keeps is documented.
- The open questions of [components.md](components.md) decided: the threshold of inlining stays a
  constant, and the names of `@keyframes` stay global. _(done)_ The rest is "The language for 1.0".

### The language for 1.0

1.0 is to be as complete as it can. Each item is decided by the maintainer first, then implemented;
the open ones are listed in "Not decided yet" of [components.md](components.md).

- Keys of lists in markup: `{for todo in todos with key todo.id { ... }}`. _(done)_
- A union of interfaces narrowed by a field of a literal type: `if d.kind == "courier"` gives
  `d.address`, and `{ kind: "pickup", shop: "..." }` fits the union. _(done, with the narrowing
  of paths: `order.delivery.kind`)_
- `derived` of several statements: `derived total number { ... return sum }`. _(done)_
- Combining decorators, and `public ref` in decorators.
- A component that returns `null` for a wrapper.
- Refs in `{if}`, `{switch}` and `{for}`, and one ref in several `return`s.
- `rook build --explain`: where the compiler did not inline a component or added a proxy, and why.
- The CSS of components in a file of its own, and the class of a style only on the elements that
  its selectors can match.

### Phase 2 — tools

- The language server: hover with the type, go to definition, find references, rename, signature
  help, document symbols.
- `rook fmt`: one style, no options, as `gofmt`; and formatting in the editor.
- `rook check`: type checking only, for CI and pre-commit hooks.
- `rook init`: a new project with Vite, Vitest and the settings of VS Code.
- `.d.ts` of `.rk` modules under the Vite plugin.

### Phase 3 — debugging goroutines

- Deadlocks: when every goroutine waits on a channel and no timer can wake one, the program stops
  with an error that says where each one waits.
- `rook run --trace`: when the program ends, the goroutines still alive and what each waits for.
- Workers named after the function of the goroutine, as DevTools shows them.

### Phase 4 — performance

- Benchmarks in `bench/`: channels, `select`, goroutines, `go for` and updates of markup, against
  the same programs written in JS by hand. The numbers on the site, and a run in CI that fails on a
  regression.
- Optimizations of the generated code only where a benchmark shows the need. Minifying is the work
  of the bundler.

## 1.0

Rook is 1.0 when:

- the specification is no longer a draft: its core is stable, and deprecation works as described;
- everything of "The language for 1.0" is in;
- the language server has navigation and rename; there are `rook fmt`, `rook check` and
  `rook init`;
- deadlocks are reported and goroutines left alive are shown;
- benchmarks run in CI, and their numbers are on the site;
- the guide shows how to bring Rook into a project and how to leave it.
