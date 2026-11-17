# Plan: the new documentation site of Rook

**English** · [Русский](PLAN.ru.md)

A working document, written on 11 November 2026 after the discussion and the prototype.

- **The approved prototype:** <https://claude.ai/artifact/MPCWCiMj1Wynka615Jq8pK>, version 3, the
  page "Channels". It is the reference for the look and the motion.
- **Status:** stage 0 is done. The engine of the scene, the pilot "Channels" and the first screen
  of the home page are on the site (stage 1). The home page as one game is done (stage 3). In stage
  2, the tracing hook, compiler option, build-time traces, pilot migration and the live Board tab
  of the playground are done. Stage 4 is done: every Concurrency section has a scene, and examples
  can be played on the board from the guide and playground. Stage 5 is implemented; browser
  verification of token motion is pending because even a minimal View Transition is rejected by
  the browser used for validation. Stage 6, the approved Pulse scene, is done. Stage 7, the bilingual
  language map, saved progress and runtime-trace-checked puzzle, is done. Stage 8, the task-board
  thread through all 35 guide sections, is done.

## 1. What we build

A site where a program can be seen. A section about threads opens with a scene: a board goes into
the distance, goroutines stand on it as rooks, messages move along its ranks. The text of the
section stays under the scene. The code in the scene is live, and the JS it compiles to is shown
beside it.

What is decided:

| Topic               | Decision                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concepts            | Live docs, a visible runtime, a translator (JS, Go → Rook), a game (a map of the language and progress).                                                                                        |
| Metaphor            | A file of the board is a goroutine or a channel. Time goes into the distance. A message is a move along a rank. Waiting is a dashed lane and a ring around the rook. A deadlock is a stalemate. |
| Screen              | One scene: the board, a card with the code at the left, one caption for the current move, a line of moves. No panels, lists of steps or legends.                                                |
| Motion              | Every motion means something. Decorative animation is allowed on the home page only.                                                                                                            |
| Rooks               | Solid pieces. A new one falls from the sky, the sender throws the value, the receiver catches it and recoils, a waiting one stands in a ring, a finished one sinks into the board.              |
| Left off the screen | The map of the language, the switch "I come from JS / Go", tasks, the number of goroutines. They come back as scenes of their own in the same style (stages 5 and 7), not on this screen.       |

## 2. The pages of the site

The addresses do not change: five pages in two languages, and the sections of the guide and the
examples have addresses of their own.

| Page                     | What changes                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                     | The first screen is the same scene with a short program in a loop, instead of the decorative lanes.                                               |
| Guide, `docs/<section>/` | The scene of the section at the top, the text below as now. An example in the text has a button "Play on the board" that loads it into the scene. |
| Guide, `docs/`           | A map of the language as a board, with progress (stage 7).                                                                                        |
| Examples                 | The new style. The tab "Without Rook" stays.                                                                                                      |
| Playground               | A tab "Board" beside the result and the console: any program with channels can be watched move by move.                                           |
| Roadmap                  | The new style only.                                                                                                                               |

Not every section has a scene. A section without one looks as it does now, in the new style.

There are three kinds of scenes:

| Scene       | What it shows                                                                         | Sections of the guide                                                          |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Game        | Goroutines and channels, move by move. This is the prototype.                         | async, goroutines, channels, select, streams, topics, channel-objects, signals |
| Pulse       | A change of state runs to the DOM nodes, and the updated node flashes in the preview. | state, components, markup, mount                                               |
| Translation | Rook code turns into JS (or into "how it would be in Go").                            | The sections about the language; optional, the text stays the main thing       |

## 3. The scene: how it is built

A scene is a player of a trace:

```text
trace (a list of events) → state at the moment T → a frame on the canvas
                                                 → the caption, the line of code, the line of moves in the DOM
```

- **T is a fractional number of a move.** Everything on the screen is computed from T, as in the
  prototype. So dragging the line of moves works both ways by itself, and the state can be tested
  without a canvas.
- **The scene does not know Rook.** It gets a trace. Where the trace came from (recorded at build
  time or made by a live run) does not matter to it.
- **Canvas 2D, no libraries.** The prototype computes the projection of the board itself, and that
  is enough.
- **The code of the scene is Rook,** in `site/src/stage/`: the site is itself a Rook program. One
  file per area, none longer than 400 lines.

| File          | What it is responsible for                                                                    |
| ------------- | --------------------------------------------------------------------------------------------- |
| `trace.rk`    | The types of events and of a trace.                                                           |
| `state.rk`    | The state at T: statuses of goroutines, the buffer, the value on its way. Pure functions.     |
| `camera.rk`   | The projection of the board and its sizes for the width of the screen.                        |
| `board.rk`    | The squares, the horizon, the dust.                                                           |
| `lanes.rk`    | The lanes of goroutines and the bridges of the moves already played.                          |
| `rooks.rk`    | The shape of a rook and what it does on each event.                                           |
| `pieces.rk`   | The value on its way, the tiles of the buffer, the rings of channels, the names of the files. |
| `player.rk`   | Time: playing, pause, the loop, dragging, keys.                                               |
| `captions.rk` | The caption of a move from its event. The texts are in `site/src/en/` and `site/src/ru/`.     |
| `stage.rk`    | The component `<Stage>`: the canvas, the card with the code, the caption, the line of moves.  |

Rules for a scene:

- It draws only while it is on the screen and the tab is active.
- With `prefers-reduced-motion` it shows a still frame, and stepping through the moves still works.
- On a phone the scene is a block above the caption and the code, as in the prototype.
- The text (the caption of the move, the code, the title) is in the HTML, not in the canvas: the
  search of the guide, `scripts/prerender.ts` and screen readers see it. The caption of the move
  is announced with `aria-live`.
- The code of the scene is loaded separately, and only on pages that have a scene.

## 4. Real moves: tracing the runtime

In the prototype a small scheduler on the page computes the moves. On the site the runtime of Rook
must give them, or the scene shows something other than what the program does.

What is known about the runtime, and what follows from it:

- The state of a channel lives in the thread that made it; the operations of other threads come to
  it as messages (`src/runtime/chan.js`, `threads.js`). So the events of one channel have a common
  order: the owner thread sees it.
- The playground sends `console.log` of workers through a `BroadcastChannel`
  (`site/src/sandbox.rk`). Trace events return through the worker tree and reach the Board tab.

A draft of the design (made exact in stage 2):

- **The hook** is a value in `globalThis` under `Symbol.for('rook.trace')`, like the other shared
  things of the runtime. No value, no tracing.
- **The events:** a goroutine started, a goroutine finished, a channel made, an operation waits, a
  value passed (hand to hand, into the buffer, out of the buffer), a channel closed, a line of the
  console.
- **The line of code and the name of the function** of each event. The runtime does not know them,
  so the compiler needs an option `trace`: with it the generator passes the place of an operation
  to the call of the runtime. This is not syntax of the language, and the maintainer chose it
  (decision 4).
- **Who made the move.** While tracing, each goroutine gets its own worker. Nested workers route
  channel messages through their parents, so they can use channels created by ancestor workers.
- **Stalemate.** All known goroutines wait on channels and no new events come: the scene shows a
  stalemate. In the roadmap this is "Phase 3 — debugging goroutines" ("A deadlock is not
  reported"), so the hook is of use there too.
- **The traces of the examples are recorded at build time** and get into the page with the code of
  the examples, like `virtual:examples`. The scene plays at once, without compiling in the browser.
  The order of moves in real threads is not defined, so recording uses one thread and
  `AsyncLocalStorage` for deterministic actor context.
- **A live run** is available in the playground's Board tab: the browser compiler emits source
  locations, the worker runtime streams events, and the scene turns them into a playable trace.
- **The cost without tracing:** one listener lookup per traced-capable operation; without a
  listener, no event or location object is made. The runtime JS files, concatenated in name order,
  grew from 81,297 B (23,695 B gzip) at `HEAD` to 89,807 B (26,113 B gzip): +8,510 B raw and
  +2,418 B gzip.

## 5. The visual system

The theme of the site now (`site/ui/theme.module.css`) is a black background, thin lines, white
text and the orange of the rook. The new theme continues it, it does not replace it:

- **The background** is a warm black instead of a pure one, with light at the horizon.
- **The light of the rook** is the same orange, `#f59e2a`: it glows (the lanes, the operator `<-`,
  the active line), it does not just colour.
- **The colours of goroutines:** orange for `main`, teal and violet for the next ones. They are
  data, not decoration: a rook, its lane, its dots in the code and its tick on the line of moves
  have one colour.
- **Red** is for a stalemate and for errors only.
- **Fonts:** see decision 2. Any new font is added the way Geist is: as an `@fontsource` package,
  without outside services.
- **The theme is dark only,** as now.
- **Ligatures are off in code:** `<-` and `<=` must look the way they are typed.

## 6. Stages

Sizes: S is up to a day of work, M is several days, L is a week or more. Each stage ends with a
working site in both languages.

### Stage 0. Decisions (S) _(done)_

The maintainer answered the open questions; the answers are in section 9.

### Stage 1. The engine of the scene and the pilot "Channels" (L)

The goal: the section `docs/channels/` looks and moves like the prototype. The runtime is not
touched.

1. Port the prototype to Rook in `site/src/stage/`, split into the files of section 3.
2. The traces of the pilot are data taken from the scheduler of the prototype, for a buffer of 0
   to 4. The live number in the code switches between them.
3. `<Stage>` in the section "Channels", English and Russian. The captions of moves are in the
   strings of both languages.
4. The tokens of the scene in the theme of the site.
5. Tests: the state at T on the traces of the pilot (statuses, the buffer, the stalemate); the site
   compiles; the build with `scripts/prerender.ts` passes and writes the text of the scene into the
   HTML.

Done when:

- on the dev server the section matches the prototype on a desktop and on a phone;
- with `prefers-reduced-motion` there is a still frame and stepping works;
- `npm run check` and `npm run site:build` pass.

### Stage 2. Real moves (L)

The goal: the pilot plays what the runtime did.

1. The hook of tracing in `src/runtime/`; `src/runtime/sources.ts` is written again by
   `npm run format`. _(done)_
2. The compiler option `trace` (decision 4). _(done)_
3. Recording the traces of scenes at build time. The pilot uses them, and the data of stage 1 is
   deleted. _(done)_
4. A live run in the browser after the code is changed; the playground's Board tab plays its trace.
   _(done)_
5. Detecting a stalemate. _(done)_
6. Tests of sending, receiving, closing and starting a goroutine, their order, and the stalemate.
   _(done)_

Done when:

- changing the buffer to 1 shows the stalemate of a real run;
- without the option `trace` the generated code does not change (`tests/output/` has no changes);
- the growth of the runtime is measured and written into section 4;
- a changed program can be run in the browser and its moves are available to the scene.

### Stage 3. The home page and the style of the whole site (M)

The goal: the whole site in one style, and the scene is the first impression.

1. The first screen of the home page is the scene with a short program in a loop (instead of the
   lanes of `site/src/home/hero.rk` and `lanes.rk`).
2. The theme of `site/ui/` in the new tokens: the header, the navigation of the guide, the cards
   with code, the page of examples, the playground, the roadmap.
3. New pictures for links: `npm run site:images`.

Done when all five pages in both languages are in one style, and Lighthouse is no worse than
before the start.

The site before the start, measured on 11 November 2026 (Lighthouse 12, its default phone
emulation, the built site served locally by `vite preview`, one run per page):

| Page              | Performance | Accessibility | Best practices | SEO | LCP   | TBT  | CLS   |
| ----------------- | ----------- | ------------- | -------------- | --- | ----- | ---- | ----- |
| `/`               | 99          | 96            | 100            | 100 | 1.7 s | 0 ms | 0.001 |
| `/docs/channels/` | 97          | 91            | 100            | 100 | 2.1 s | 0 ms | 0     |
| `/playground/`    | 95          | 96            | 100            | 100 | 2.6 s | 0 ms | 0     |

#### The home page as one game

Decided on 13 November 2026. The board is one for the whole page: the first screen is the opening,
each block below shows its part of the language on the same board, and the end of the page is the
endgame.

| Block                                  | What becomes a scene                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first screen                       | Done: the game with channels.                                                                                                                                                               |
| "One thread, or every core" (`go for`) | Done: the array lies as tiles across the board, the rook of `main` walks it alone, then the array splits, a rook falls on each part and they all walk at once. The timers stay.             |
| Card "Goroutines on real threads"      | Done: a small board. The call runs to a free file, a rook falls there, `main` waits, the result comes back as a move.                                                                       |
| Card "Channels and select"             | Done: `main` stands between `messages` and `after(500)` with a dashed line to each; a message or the end of the time is played, in turn. A link "move by move" to the section of the guide. |
| Card "Types that know about threads"   | Done: a string flies through the border between two threads, and the DOM element `title` bounces off it in red. The compiler's error under the board flashes.                               |
| Card "Readable JavaScript"             | Done: the card left the grid and merged with "Write Rook. Ship JavaScript" below.                                                                                                           |
| Card "Markup and components"           | Done, as two cards. "Components in the browser": the live counter, and on a click a pulse runs from the code to the button. "Components on the server": a component of a server.            |
| Card "Tools included"                  | Stays as it is: a list needs no scene.                                                                                                                                                      |
| "Write Rook. Ship JavaScript"          | Done: one card where Rook turns into JavaScript word by word, with three examples; the words both languages have stay on the screen and move.                                               |
| "Start in a minute"                    | Stays as it is: three steps with commands.                                                                                                                                                  |
| The final call                         | Done: the board in perspective, empty, with the one rook of `main` in the ring of one who waits and "your move" under it; it hops when the reader comes to the button "Start".              |

The order: `go for` in the full width _(done)_; then the three small boards of the cards _(done)_;
then the change of code and the final call _(done)_. The small boards are the same engine, smaller, and each plays
only while it is on the screen.

The scene of `go for` (prototype: <https://claude.ai/artifact/Y7rWkseAEot9HMrCd8x1iQ>, version 2):

- It is not a trace: its model is `site/src/stage/array.rk` (the scene at a moment, in seconds),
  drawn by `array-scene.rk`; the block of the page is `site/src/home/go-for.rk`.
- A rook for each part: 4 on a phone, 8 up to 1100 px, 14 on a wide screen, as many as the cores of
  the measurement.
- go for takes as much less time on the screen as it was measured to (1325 ms against 164 ms); the
  split of the array and the fall of the rooks are outside the timers.
- No lines of time on the board: the maintainer took them out of the prototype.

The small boards (prototype: <https://claude.ai/artifact/JvpTmG6GUmy96ygNuCwNJ5>):

- A scene is a round that repeats: `site/src/stage/small-go.rk`, `small-select.rk` and
  `small-types.rk`, with what they share in `small.rk` and `poses.rk`. The component is
  `site/src/home/small-board.rk`; it plays only while it is on the screen.
- A scene returns the mark of its frame, the component puts it into `data-mark`, and the styles of
  the card light up the text the frame is about: the case of the select, the compiler's error.
- The only lines are those of a move (a call, a value, the dashes of what a select may play); they
  go out after the move.

The change of code and the final call (prototype:
<https://claude.ai/artifact/JEsNmSGXWUzM6ykM3NKmox>):

- `site/src/home/words.rk` splits both pieces of code into words and pairs the equal ones in the
  same order, a name before a bracket; `compare.rk` gives each word its place in the language
  shown, and CSS moves it. The example turns into JavaScript by itself once, then the switch
  "Rook / JavaScript" is the reader's. No buttons to copy the code.
- The last board is `site/src/stage/endgame.rk`, drawn by `site/src/home/call-to-action.rk`.

### Stage 4. The scenes of threads and the "Board" of the playground (L)

| Section         | What is new on the board                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| goroutines      | Copies of the arguments fly to the new rook, the result comes back as a move. `go for`: several rooks on the parts of an array. |
| channels        | Messages wait in the buffer or go hand to hand.                                                                                 |
| select          | The lines of all the cases are lit in front of the rook, and one is played.                                                     |
| streams, topics | One move goes out to all the subscribers.                                                                                       |
| signals         | A cancellation is a capture: the rook goes dark and leaves the board.                                                           |
| async           | The tasks of one thread take turns on one file.                                                                                 |
| channel-objects | `Channel.make`, `send`, `receive` and `close` are visible as moves.                                                             |

Also in this stage: the button "Play on the board" of examples and the tab "Board" of the
playground.

Done when every section of the group Concurrency has a scene in both languages, and a program with
channels from the playground plays on the board.

### Stage 5. The translator (M) _(implemented; motion verification pending)_

1. The tabs of the card with the code: Rook, the JS output, "Without Rook" (the files of
   `site/examples/js/<name>/`).
2. The switch "I come from JS / TS / Go"; the choice is remembered. The text of the sections gets
   notes for those who come from Go. This is new text in two languages.
3. The code morphs when switching Rook → JS: the tokens they share stay in place, the others move.

### Stage 6. The scene "Pulse" (L) _(done)_

Reactivity: a state change runs as a pulse through its dependency graph to the DOM nodes that read
it. The approved prototype is in `site/prototypes/pulse.html`.

1. Trace state changes and each dependent DOM update in code generated with `trace`.
2. Keep the live tracer installed for the lifetime of the preview owner; restore the previous
   tracer when the preview is replaced or removed.
3. Build the live graph and DOM preview into the guide sections Markup, Components, State and
   Mounting, in both languages.
4. Respect `prefers-reduced-motion`; test that independent nodes do not flash.
5. Run `npm run check` and `npm run site:build`, then verify the scene in the browser.

### Stage 7. The map, progress, tasks (M) _(done)_

1. `docs/` opens with the map of the language: a square is a section, the rook stands on the
   current one, what is read is marked. The progress is kept in the browser.
2. Tasks in the scene ("mate in one": remove the stalemate by changing one number), checked by the
   trace.

The map is integrated at `docs/`; section pages record progress in local storage, and the puzzle
uses the live runtime trace to distinguish a stalemate from a successful buffered send and receive.

### Stage 8. One application through the guide (M) _(done)_

The approved application is a small task board. The guide follows one workspace from its first
typed task to an interactive board and a server-rendered page. Keep the existing explanations of
Rook complete; make their examples and transitions advance the same application rather than
replacing the language reference with a tutorial. Keep the examples truthful to Rook's current
syntax and APIs; this stage does not change the language.

| Sections                                                                      | The task board gains                                                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| intro, variables, bigint, queues, null, functions, errors, control, iterators | A typed task model, stable IDs, task batches, optional selection, and the operations and transitions that make up the domain.                       |
| classes, generics, make, modules                                              | Reusable task behavior, a typed collection, initial state, and a module boundary.                                                                   |
| async, goroutines, channels, select, streams, topics, channel-objects         | Loading and saving, background work, task commands and results, competing events, an activity stream, and shared updates.                           |
| try, decode, async-iterables, signals                                         | Safe storage and input decoding, processing incoming updates, and orderly cancellation.                                                             |
| markup, components, state, mount, ref, styles, web-components, decorators     | A live board, reusable task rows, reactive filters and counts, connected lifetimes, focus, visual status, embedding, and shared component behavior. |
| server-components, tools, adoption                                            | A server-rendered board and its request boundary, the commands to build and check it, and how to introduce Rook into an existing project.           |

Rewrite and connect the 35 sections in both languages, updating the examples where needed. The
finished path should make clear what the reader has built, preserve direct reference material, and
leave each section's existing runnable examples compiling.

## 7. How we work

- A new look or a new kind of scene is made as a prototype artifact first and approved, then
  ported to the site.
- English and Russian change in the same change: strings, texts of sections, examples.
- No code file is longer than 400 lines; split by responsibility ahead of time.
- After each stage: `npm run check`, `npm run site:build`, a look at the dev server.
- Commit and push only when asked. Pushing a new version to `main` publishes the site, so an
  unfinished stage does not go to `main` (decision 8).
- This plan does not change the syntax of the language. If the work runs into the language, the
  options go to the maintainer separately.

## 8. Risks

| Risk                                                                            | What we do                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The glow on the canvas is slow on weak phones                                   | Measure in stage 1. A fallback mode: fewer layers of glow, no dust.                                               |
| The order of moves in threads is not defined, so a recorded trace is not stable | A deterministic recording at build time; a test compares the trace with the example.                              |
| It is unclear which goroutine made a move when a thread holds several calls     | One goroutine per thread while tracing. The tasks of one thread are told apart by the function.                   |
| Prerender waits for the page, and the scene animates forever                    | The first frame is deterministic; check how `scripts/prerender.ts` waits, in stage 1.                             |
| Canvas code in Rook turns out awkward                                           | That is a finding for the language: write down what was in the way. TypeScript only if the maintainer decides so. |
| The amount of text in two languages (captions, notes, tasks)                    | Captions are built from templates by the kind of event; text by hand only where a template is not enough.         |
| A screen reader cannot read the scene                                           | The caption of a move in `aria-live`, control from the keyboard, the whole text of the section under the scene.   |

## 9. Decisions

The maintainer decided these on 11 November 2026 (stage 0). What was not chosen is kept, so that
the choice is not made again.

1. **Where the scene lives:** at the top of a section of the guide; the addresses do not change.
   Not chosen: a separate page "Tour" with a text of its own, which is twice the text in two
   languages.
2. **Fonts:** Geist and Geist Mono stay, and one display font is added for titles (Unbounded in
   the prototype). Not chosen: changing all of them, as in the prototype (Onest, JetBrains Mono).
3. **The language of the code of the scene:** Rook. Not chosen: TypeScript, like the editor in
   `site/src/editor/`.
4. **How a trace knows the line of code:** the compiler option `trace`. Not chosen: the call stack
   and a source map.
5. **Tracing and the roadmap:** tracing is built as the base of "Phase 3 — debugging goroutines"
   from the start, but is not called a public API before 1.0.
6. **Editing the code in the scene:** live numbers and a button "Open in the playground". A full
   editor in the card comes later, if it is needed.
7. **The order:** the home page comes first. Its first screen gets the scene right after the pilot,
   inside stage 1, because the home page is what a visitor sees first; the common style of the
   other pages (the rest of stage 3) still comes before the other scenes (stage 4).
8. **The branch:** the work goes in a branch `site-redesign` and is merged into `main` stage by
   stage.

## 10. Checklist: adding a scene to a section

1. The example of the section is in `site/examples/` and `site/examples/ru/` and compiles.
2. The trace of the example is recorded at build time and has all the events the scene needs.
3. If new events are needed: the runtime and its tests.
4. If new pieces or motions are needed: a prototype first, then a file in `site/src/stage/`.
5. The captions of moves in the strings of both languages.
6. `<Stage>` in the section, in both languages.
7. A test of the state at T for the new trace.
8. `npm run check`, `npm run site:build`, a look on a desktop, on a phone and with
   `prefers-reduced-motion`.
