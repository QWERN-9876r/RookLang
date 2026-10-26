import { fileURLToPath } from 'node:url';
import {
  CodeActionKind,
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compile, complete, importFixes } from '../../../src/index.ts';
import { toCompletionItems, toDiagnostics, toImportActions } from './convert.mts';

// The language server of Rook: errors and warnings of the compiler for the open files,
// completion, and imports of the names of other modules, by completion or by a quick fix. It runs in a process of its own, since the first check of a file loads the types of
// the DOM from TypeScript, which takes a while.

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** Checks of changed files that wait for the typing to stop. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const DELAY = 200;

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ['.', '<'] },
    codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
  },
}));

/** The path of a document on disk: imports are found from it. Unsaved new files have none. */
function filename(uri: string): string | undefined {
  return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
}

function validate(document: TextDocument): void {
  pending.delete(document.uri);

  const path = filename(document.uri);

  try {
    // The same errors as `rook build` gives; the generated code is not needed here.
    const result = compile(document.getText(), path ? { filename: path } : {});

    void connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: toDiagnostics(document, result),
    });
  } catch (error) {
    connection.console.error(`cannot check ${document.uri}: ${String(error)}`);
  }
}

function schedule(document: TextDocument): void {
  clearTimeout(pending.get(document.uri));
  pending.set(
    document.uri,
    setTimeout(() => validate(document), DELAY),
  );
}

// Also called when a document is opened.
documents.onDidChangeContent(({ document }) => schedule(document));
documents.onDidClose(({ document }) => {
  clearTimeout(pending.get(document.uri));
  pending.delete(document.uri);
  void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

// Other files see the modules they import as they are on disk: check them again when one is saved.
documents.onDidSave(() => documents.all().forEach(schedule));
connection.onDidChangeWatchedFiles(() => documents.all().forEach(schedule));

connection.onCompletion(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);

  if (!document) return [];

  const path = filename(document.uri);

  try {
    const list = complete(
      document.getText(),
      document.offsetAt(position),
      path ? { filename: path } : {},
    );

    return toCompletionItems(document, list);
  } catch (error) {
    connection.console.error(`cannot complete in ${document.uri}: ${String(error)}`);

    return [];
  }
});

connection.onCodeAction(({ textDocument, context }) => {
  const document = documents.get(textDocument.uri);
  const path = document && filename(document.uri);

  if (!document || !path) return [];

  try {
    return context.diagnostics.flatMap((diagnostic) =>
      diagnostic.source === 'rook' && typeof diagnostic.message === 'string'
        ? toImportActions(
            document,
            diagnostic,
            importFixes(document.getText(), path, diagnostic.message),
          )
        : [],
    );
  } catch (error) {
    connection.console.error(`cannot fix ${document.uri}: ${String(error)}`);

    return [];
  }
});

documents.listen(connection);
connection.listen();
