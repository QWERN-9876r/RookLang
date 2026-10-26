import type * as ast from '../ast.ts';
import { CompletionChecker } from './completion.ts';
import type { CheckOptions, CheckResult } from './context.ts';

export type {
  CheckOptions,
  CheckResult,
  Completion,
  CompletionContext,
  CompletionResult,
  ImportResult,
  Library,
  ModuleExports,
  TextEdit,
} from './context.ts';

// The type checker of a module; its layers are listed in base.ts.

class Checker extends CompletionChecker {
  run(): CheckResult {
    this.checkStatementList(this.program.body, true);
    this.checkEndlessRecursion();
    this.checkIterators();
    this.checkHtmlTags();
    this.checkClosing();
    this.diagnostics.sort((a, b) => a.start - b.start);
    this.warnings.sort((a, b) => a.start - b.start);

    return {
      diagnostics: this.diagnostics,
      warnings: this.warnings,
      ...this.collectDeclarations(),
      types: this.checkedTypes,
      dataClasses: this.dataClasses(),
      ...(this.completion ? { completion: this.completion } : {}),
    };
  }

  /** The names of the module that are data classes: its own, and those it imports. */
  private dataClasses(): Set<string> {
    const names = new Set<string>();

    for (const statement of this.program.body) {
      const declared =
        statement.kind === 'ClassDeclaration'
          ? [statement.name.name]
          : statement.kind === 'ImportDeclaration'
            ? statement.namedImports.map((specifier) => specifier.local.name)
            : [];

      for (const name of declared) {
        const type = this.lookupValue(name)?.type;

        if (type?.kind === 'classValue' && type.info.data === true) names.add(name);
      }
    }

    return names;
  }
}

export function check(program: ast.Program, options: CheckOptions = {}): CheckResult {
  return new Checker(program, options).run();
}
