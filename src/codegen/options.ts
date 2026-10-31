import type * as ast from '../ast.ts';
import type { Type } from '../checker/types.ts';
import type { DecoratorSource } from '../decorators.ts';
import type { InlinePackage } from '../inline-packages.ts';
import type { StyleModule } from '../style-modules.ts';
import type { ImportedComponent } from './imported.ts';
import type { RuntimeMode } from './runtime.ts';

// What the generator of a module is given: its source, the types of the checker, and what it
// takes of other modules.

export interface JsOptions {
  /** The Rook source, used to keep the blank lines between statements. */
  source: string;
  /** Replace `.rk` with `.js` in relative import paths, for output written next to the sources. */
  rewriteImports: boolean;
  /** Types from the checker, when it ran; without them the generated code is more general. */
  types?: WeakMap<ast.Expression, Type> | undefined;
  /** Decorators imported from other modules, by name: their code is inlined here. */
  decorators?: ReadonlyMap<string, ImportedDecorator> | undefined;
  /** Components imported from other modules, by name: called, or inlined when they are small. */
  components?: ReadonlyMap<string, ImportedComponent> | undefined;
  /** Components of the module that become functions, since inlining them adds too many lines. */
  functions?: ReadonlySet<string> | undefined;
  /** The CSS modules the module imports, by their paths as written. */
  styleModules?: ReadonlyMap<string, StyleModule> | undefined;
  /** For `go`: where the worker module is (`./app.worker.js`), or in it, the functions it runs. */
  goroutines?:
    | { workerUrl: string; nodeLoader?: string | undefined }
    | { targets: readonly string[] }
    | undefined;
  /** How the module gets the runtime it uses: imported, by default, or in it (runtime.ts). */
  runtime?: RuntimeMode | undefined;
  /** The data classes of the module, whose imports stay even if only types use them. */
  dataClasses?: ReadonlySet<string> | undefined;
  /** State of other modules that this one imports, `local → name there`: it only reads it. */
  shared?: ReadonlyMap<string, string> | undefined;
  /** What each `export { ... } from` passes on in JS, with hidden names (reexports.ts). */
  reexports?: ReadonlyMap<ast.ExportFromDeclaration, readonly string[]> | undefined;
}

/** A decorator of another module, with the types of the expressions of that module. */
export interface ImportedDecorator extends DecoratorSource {
  types: WeakMap<ast.Expression, Type> | null;
  /** The components of that module its code uses, which go with it into the components here. */
  inline: InlinePackage | null;
}
