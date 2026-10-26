import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  type CodeAction,
  type CompletionItem,
  type Diagnostic,
  type TextEdit,
} from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type {
  CompileResult,
  Completion,
  CompletionList,
  ImportFix,
  TextEdit as CompilerTextEdit,
} from '../../../src/index.ts';

// What the compiler gives, as the language server protocol wants it: offsets become positions.

export function toDiagnostics(document: TextDocument, result: CompileResult): Diagnostic[] {
  const convert = (
    { message, start, end }: CompileResult['diagnostics'][number],
    severity: DiagnosticSeverity,
  ): Diagnostic => ({
    message,
    severity,
    source: 'rook',
    range: { start: document.positionAt(start), end: document.positionAt(end) },
  });

  return [
    ...result.diagnostics.map((each) => convert(each, DiagnosticSeverity.Error)),
    ...result.warnings.map((each) => convert(each, DiagnosticSeverity.Warning)),
  ];
}

const KINDS: Record<Completion['kind'], CompletionItemKind> = {
  variable: CompletionItemKind.Variable,
  constant: CompletionItemKind.Constant,
  function: CompletionItemKind.Function,
  class: CompletionItemKind.Class,
  component: CompletionItemKind.Class,
  type: CompletionItemKind.Interface,
  property: CompletionItemKind.Property,
  method: CompletionItemKind.Method,
  keyword: CompletionItemKind.Keyword,
  tag: CompletionItemKind.Property,
  attribute: CompletionItemKind.Value,
};

export function toCompletionItems(document: TextDocument, list: CompletionList): CompletionItem[] {
  const range = { start: document.positionAt(list.start), end: document.positionAt(list.end) };

  // The compiler lists the nearest names first; VS Code keeps that order among equal matches.
  return list.items.map((item, index) => ({
    label: item.name,
    kind: KINDS[item.kind],
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    // A name of another module: its path is shown next to it, and the import is added with it.
    ...(item.import && {
      labelDetails: { description: item.import.specifier },
      detail: `import from "${item.import.specifier}"`,
      additionalTextEdits: [toTextEdit(document, item.import.edit)],
    }),
    sortText: String(index).padStart(5, '0'),
    textEdit: { range, newText: item.name },
  }));
}

export function toTextEdit(document: TextDocument, edit: CompilerTextEdit): TextEdit {
  return {
    range: { start: document.positionAt(edit.start), end: document.positionAt(edit.end) },
    newText: edit.text,
  };
}

/** Quick fixes for the errors about names that are not defined: imports from other modules. */
export function toImportActions(
  document: TextDocument,
  diagnostic: Diagnostic,
  fixes: readonly ImportFix[],
): CodeAction[] {
  return fixes.map((fix) => ({
    title: fix.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    // Only one module exports the name: VS Code may apply the fix by itself (Auto Fix).
    isPreferred: fixes.length === 1,
    edit: { changes: { [document.uri]: [toTextEdit(document, fix.edit)] } },
  }));
}
