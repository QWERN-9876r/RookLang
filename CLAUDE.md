# Rook — rules for Claude Code

Rook is a language with JavaScript semantics, Go-style syntax and static types. It compiles
to readable JavaScript that imports a small runtime library, `rooklang/runtime`. The compiler is written in TypeScript and runs on
Node 24. The specification with the reasons for its decisions is in `docs/spec.md`, the design of
markup and components in `docs/components.md`.

## Working with the maintainer

- The maintainer writes in Russian: answer in Russian.
- **The maintainer decides the syntax.** Do not invent syntax or change the meaning of existing
  constructs on your own: offer a few options side by side, with a recommendation, and ask.
- Commit and push only when asked. Pushing to `main` deploys the site
  (https://qwern-9876r.github.io/RookLang/) through `.github/workflows/pages.yml`, so confirm
  before every push.
- The working tree may hold the maintainer's own uncommitted edits (e.g. `examples/hello.rk`).
  Do not commit, stash or revert them: stage files by name, not with `git add -A`.
- Commit messages: an English subject in the imperative ("Add @html-tag: ..."), then a body that
  says what changed and why.

## Commands

```sh
npm run check                         # tsc, eslint, prettier --check, vitest: run before saying "done"
npx vitest run tests/html-tag.test.ts # one test file
npx vitest run -u tests/output.test.ts # write tests/output/ again after a change of the generated code
npm run rook -- build app.rk      # compile (app.js next to the source); `run` compiles and runs
node src/cli.ts ast file.rk        # print the AST
npm run site:dev / site:build / site  # the docs site: Vite dev server / build (needs Chrome) / build and serve
npm run site:images                   # redraw the og:image pictures of site/public (needs Chrome)
npm run vscode:build                  # bundle the VS Code extension and its language server
npm run vscode:install                # rebuild and install the VS Code extension
npm run format                        # prettier --write, eslint --fix for blank lines, src/runtime/sources.ts
```

## Code rules

- **No code file is longer than 400 lines** (`.ts`, `.js`, `.rk`, `.css`, `.html`, `.json`;
  Markdown is not counted). ESLint `max-lines` and `tests/repository.test.ts` enforce it. Split by
  responsibility before a file reaches the limit, as the existing code does.
- Node runs the `.ts` files directly (type stripping): only erasable TypeScript (no `enum`,
  `namespace`, parameter properties), relative imports end in `.ts`, types are imported with
  `import type`.
- The lexer, parser, checker, code generator and TypeScript converter are **chains of layer
  classes**, one area per file. The order of each chain is in the comment at the top of its
  `base.ts` (`src/codegen/emitter.ts` for the generator). A method that an earlier layer calls but a
  later one implements is declared `protected abstract` in the base and implemented with
  `protected override`. A new area becomes a new layer file inserted into the chain.
- `src/ast.ts` and `src/checker/types.ts` are barrels over `src/ast/` and `src/checker/types/`.
  `src/checker/types/model.ts` must not have runtime imports: that would create an ESM cycle.
- The editor of the playground is Monaco (`site/src/editor/`, TypeScript with the DOM, checked by
  `site/tsconfig.json`); it highlights with the grammar of `editors/vscode/syntaxes/`, so a change
  of the grammar shows there too.
- Markup and components are off unless the package turns them on (`src/config.ts`): this
  repository does, with `"rook": { "markup": true }` in `package.json`, and tests in
  temporary directories use `markupProject()` of `tests/project.ts`. The browser compiler takes
  `{ markup: true }`.
- `src/browser.ts` is the compiler of the site's playground: it has no TypeScript compiler. Code in
  `src/typescript/` (types from `.d.ts` and `lib.dom`) is Node-only and must not be imported from
  it; without it the checker falls back to `src/checker/builtins.ts` and `src/checker/dom.ts`.
- Names in generated JS start with `$$`; Rook code cannot use such names. The runtime that
  generated code imports from `rooklang/runtime` is plain JS in `src/runtime/` (exported as is,
  without a build); the generator imports the names its output uses (`src/codegen/runtime.ts`).
  `src/runtime/sources.ts` has the text of these files for `runtime: 'inline'` (the playground,
  tests that run code without imports): `npm run format` writes it again, and a test fails if it is
  out of date.
- Diagnostics: English, lowercase, and say how to fix the problem, with an example where it helps:
  `"page" ... must have a hyphen; give one, e.g. @html-tag("app-page")`.
- Comments are in English and explain why, at the density of the surrounding code.
- Blank lines between statements are an ESLint rule (`@stylistic/padding-line-between-statements`
  in `eslint.config.js`): Prettier keeps them but never adds them. The pre-commit hook
  (`scripts/format-staged.ts`) formats the staged files, so check `git status` after a commit.

## Documentation and the site

- **English is the default language everywhere**, Russian goes alongside, and both are kept in sync
  in the same change:

  | English                   | Russian                      |
  | ------------------------- | ---------------------------- |
  | `README.md`               | `README.ru.md`               |
  | `docs/spec.md`            | `docs/spec.ru.md`            |
  | `docs/components.md`      | `docs/components.ru.md`      |
  | `editors/vscode/*.md`     | `editors/vscode/*.ru.md`     |
  | `site/src/en/` (site `/`) | `site/src/ru/` (site `/ru/`) |
  | `site/examples/*.rk`      | `site/examples/ru/*.rk`      |

- `editors/vscode/README.md` is the page of the extension in the Marketplace, so it is written for
  its users; building the extension and working on it go to `editors/vscode/DEVELOPMENT.md`.

- The site is itself a Rook program (`site/src`, server `site/server.rk`), built by Vite
  with the plugin `src/vite.ts`. `tests/site.test.ts` compiles it, compiles every example with the
  browser compiler and checks that each example exists in both languages and is used by the guide
  (`site/src/<lang>/guide/`, a file for each section) or by the page of examples
  (`site/src/<lang>/cases.rk`, laid out by `site/src/examples/`: the list of examples at the side,
  the code of the one chosen beside its result). An example there is a whole program beside the
  same program written in JS by hand, in `site/examples/js/<name>/` (`site/examples/ru/js/` for
  Russian), which its tab "Without Rook" shows.
- Titles and descriptions of pages are in their `index.html`; `site/seo.ts` makes from them the
  canonical address, hreflang, Open Graph, JSON-LD, `sitemap.xml` and `robots.txt`. A new page goes
  into `PAGES` of `vite.config.ts`.
- Each section of the guide and each example has an address of its own, `docs/goroutines/`
  (`site/sections.ts`, `site/src/sections.rk`); links between sections are relative, `../channels/`,
  and change the address without loading the page. `npm run site:build` ends with
  `scripts/prerender.ts`: headless Chrome draws every page, and its HTML, with the text in it, is
  written to `site/dist`, one page per section, with the title, the first paragraph as the
  description and tags of its own. The scripts of a page draw it again with `replaceChildren`.

## Adding a language feature

Go through the whole list; tests must cover each layer that changed.

1. Lexer, AST (`src/ast/`), parser; `src/walk.ts` if the AST has new children.
2. Checker: types, error messages.
3. Code generator; the runtime in `src/runtime/` if needed.
4. Tests in `tests/` by area. DOM behaviour is tested with the small fake DOM in
   `tests/fake-dom.ts` (`mountWithDom`, `runWithDom`): extend it rather than adding jsdom. If the
   output of an example changed, write `tests/output/` again and read its diff.
5. `docs/spec.md` (and `docs/components.md` for markup and components), in both languages.
6. A guide section and an example on the site, in both languages.
7. Highlighting: the VS Code grammar in `editors/vscode/syntaxes/` with a case in
   `tests/vscode-grammar.test.ts`, and the site highlighter `site/src/highlight.rk`.
8. The playground (`site/src/sandbox.rk`, the page in `site/src/playground/`) if the generated code
   needs something from the page.
9. `npm run check`; for site changes also `npm run site:build`.
