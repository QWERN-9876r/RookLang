import { describe, expect, it } from 'vitest';
import { CodeActionKind, CompletionItemKind, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  toCompletionItems,
  toDiagnostics,
  toImportActions,
} from '../editors/vscode/src/convert.mts';
import { compile, complete } from '../src/index.ts';

// The language server of the VS Code extension: what it sends for the results of the compiler.

function document(text: string): TextDocument {
  return TextDocument.create('file:///app.rk', 'rooklang', 1, text);
}

describe('language server', () => {
  it('sends errors and warnings with their lines and columns', () => {
    const text = 'let a = 1\nlet b string = a\n';
    const [error] = toDiagnostics(document(text), compile(text));

    expect(error).toEqual({
      message: 'cannot use number as string',
      severity: DiagnosticSeverity.Error,
      source: 'rook',
      range: { start: { line: 1, character: 15 }, end: { line: 1, character: 16 } },
    });

    const warnings = toDiagnostics(document(text), {
      code: '',
      diagnostics: [],
      warnings: [{ message: 'unused', start: 0, end: 3 }],
      dependencies: [],
    });

    expect(warnings[0]?.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('sends completion items that replace the name being typed, in the order of the compiler', () => {
    const text = 'let total = 1\nconsole.log(to)';
    const [item] = toCompletionItems(document(text), complete(text, text.length - 1));

    expect(item).toEqual({
      label: 'total',
      kind: CompletionItemKind.Variable,
      detail: 'number',
      sortText: '00000',
      textEdit: {
        range: { start: { line: 1, character: 12 }, end: { line: 1, character: 14 } },
        newText: 'total',
      },
    });
  });

  it('sends the import of a name of another module with its item', () => {
    const text = 'import { a } from "./a.rk"\nfo';
    const [item] = toCompletionItems(document(text), {
      start: 27,
      end: 29,
      items: [
        {
          name: 'format',
          kind: 'function',
          import: { specifier: './lib.rk', edit: { start: 18, end: 26, text: ', format' } },
        },
      ],
    });

    expect(item).toMatchObject({
      label: 'format',
      labelDetails: { description: './lib.rk' },
      detail: 'import from "./lib.rk"',
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 18 }, end: { line: 0, character: 26 } },
          newText: ', format',
        },
      ],
    });
  });

  it('sends quick fixes that import a name, preferred when there is one', () => {
    const text = 'format()';
    const [diagnostic] = toDiagnostics(document(text), compile(text));
    const fix = {
      title: 'Add import { format } from "./lib.rk"',
      edit: { start: 0, end: 0, text: 'import' },
    };
    const [action] = toImportActions(document(text), diagnostic!, [fix]);

    expect(action).toEqual({
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      edit: {
        changes: {
          'file:///app.rk': [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: 'import',
            },
          ],
        },
      },
    });
    expect(toImportActions(document(text), diagnostic!, [fix, fix])[0]?.isPreferred).toBe(false);
  });
});
