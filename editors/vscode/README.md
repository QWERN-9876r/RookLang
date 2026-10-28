# Rook for VS Code

**English** · [Русский](README.ru.md)

Support for Rook, a language with the semantics of JavaScript, Go-style syntax and static
types, in `.rk` files: highlighting, errors as you type, completion and imports.

## Errors, completion and imports

The extension starts a language server with the Rook compiler. While you type, it underlines
the errors and warnings that `rook build` would print, and it completes:

- names in scope: variables, parameters, functions, classes, components, globals such as `document`,
  and keywords;
- members after `.` and `?.`, with their types: of classes (private ones only inside the class),
  interfaces, objects, strings, arrays and the DOM;
- types where a type is written: `let user Us|`;
- tags and components in markup, `<Ca|`, and the properties of a component or the attributes and
  events of an element, `<input on|`;
- names that other `.rk` files of the package export: functions, classes, constants, types and
  components. The path of the file is shown next to the name, and choosing it adds the import:
  into `import { ... }` of that file if the module has one, else on a new line after the last
  import.

A name that is not defined (`"formatDate" is not defined`, `unknown type "User"`, `unknown component
<Card>`, `unknown decorator @visible`) gets a quick fix (`Cmd+.`) that imports it from each file of
the package that exports it.

The types of the standard library and the DOM come from TypeScript's lib files, which the extension
carries. The package of a file is the directory of its nearest `package.json`, without `node_modules`,
`dist`, `build`, `out`, `coverage` and folders whose names start with a dot. Imports of other `.rk` files and of packages with types are checked as in `rook build`.
Markup and components are errors unless the nearest `package.json` turns them on with
`"rook": { "markup": true }`, as for `rook build`.

## Highlighting

It highlights:

- keywords, the declarations `func`, `comp`, `class`, `interface`, `type`, `state` and `mount()`;
- Go-style types: `number`, `[]Todo`, `?User`, names of classes and interfaces;
- strings, template strings with `${...}`, numbers, comments;
- markup: tags, components, attributes, `on*`, `bind:value`, expressions in `{...}`, and `if`,
  `for` and `switch` inside it.

The extension also sets up comments (`Cmd+/`), closing brackets and quotes, and a 4-space indent.

## Installation

Search for "Rook Language" in the Extensions view of VS Code, or install it from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Qwern9876r.rooklang).
VSCodium, Cursor and other editors that use [Open VSX](https://open-vsx.org/extension/Qwern9876r/rooklang)
find it there. From the command line:

```sh
code --install-extension Qwern9876r.rooklang
```

The extension carries its own copy of the compiler, so it needs nothing else. To build and run
`.rk` files, install the compiler too: `npm install --save-dev rooklang`.

## Which compiler checks the files

If `rooklang` is installed in the project, the extension checks a file with that version: the one
in the nearest `node_modules/rooklang` up from the file, as Node would find it. So the editor shows
the errors of the same version that `rook build` runs, and a new version is used as soon as it is
installed, without reloading the window. Without an installed `rooklang`, the extension uses its
own copy.

The status bar shows which compiler checked the file being edited: `Rook 0.3.4` for the installed
one, `Rook (built-in)` for the copy of the extension; its tooltip says where it is. The output
panel "Rook" says which version was loaded, or why it could not be, in which case the extension
uses its own copy.

Loading the installed compiler runs code of the project, so in a workspace that VS Code does not
trust (Restricted Mode) the extension uses its own copy; it switches once you trust the
workspace.

## Limitations

As with `rook build`, a file with a syntax error shows only its syntax errors: the types are
checked once it parses. A file sees the other `.rk` files it imports as they are saved on disk.

The highlighting is a TextMate grammar: it looks at the text of a line, not at a syntax tree. So:

- `<` is taken as the start of markup if there is no value before it (a name, `)` or `]`) and a tag
  name right after it. `a < b` and `i<n` are comparisons, and `return <div>` is markup;
- types are recognized by their look: the built-in ones (`number`, `string`…) and names with a
  capital letter. Your own types with a lowercase letter (`type id = number`) are highlighted as
  ordinary names.
