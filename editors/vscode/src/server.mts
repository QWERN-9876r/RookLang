import { fileURLToPath } from 'node:url';
import {
  CodeActionKind,
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compilerFor, type Compiler } from './compiler.mts';
import { toCompletionItems, toDiagnostics, toImportActions } from './convert.mts';

// The language server of Rook: errors and warnings of the compiler for the open files,
// completion, and imports of the names of other modules, by completion or by a quick fix. It runs
// in a process of its own, since the first check of a file loads the types of the DOM from
// TypeScript, which takes a while. The compiler is the one installed next to the file, in a trusted
// workspace, else the copy of the extension (compiler.mts); after each check the client hears
// which one it was, to show it.

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** Checks of changed files that wait for the typing to stop. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const DELAY = 200;
/** Whether the workspace is trusted, so that the compiler installed in it may run. */
let trusted = false;

connection.onInitialize(({ initializationOptions }) => {
  trusted = (initializationOptions as { trusted?: boolean } | undefined)?.trusted === true;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ['.', '<'] },
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
    },
  };
});

// The workspace has been trusted: check the files again, with the compiler installed in it.
connection.onNotification('rook/trusted', () => {
  trusted = true;
  documents.all().forEach(schedule);
});

// Another rooklang has been installed: check the files again, with it.
connection.onNotification('rook/recheck', () => documents.all().forEach(schedule));

/** The path of a document on disk: imports are found from it. Unsaved new files have none. */
function filename(uri: string): string | undefined {
  return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
}

function compilerOf(path: string | undefined): Promise<Compiler> {
  return compilerFor(path, trusted, (message) => connection.console.log(message));
}

async function validate(document: TextDocument): Promise<void> {
  pending.delete(document.uri);

  const path = filename(document.uri);

  try {
    const compiler = await compilerOf(path);
    // The same errors as `rook build` gives; the generated code is not needed here.
    const result = compiler.compile(document.getText(), path ? { filename: path } : {});

    void connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: toDiagnostics(document, result),
    });
    void connection.sendNotification('rook/compiler', {
      uri: document.uri,
      installed: compiler.installed,
    });
  } catch (error) {
    connection.console.error(`cannot check ${document.uri}: ${String(error)}`);
  }
}

function schedule(document: TextDocument): void {
  clearTimeout(pending.get(document.uri));
  pending.set(
    document.uri,
    setTimeout(() => void validate(document), DELAY),
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

connection.onCompletion(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);

  if (!document) return [];

  const path = filename(document.uri);

  try {
    const { complete } = await compilerOf(path);
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

connection.onCodeAction(async ({ textDocument, context }) => {
  const document = documents.get(textDocument.uri);
  const path = document && filename(document.uri);

  if (!document || !path) return [];

  try {
    const { importFixes } = await compilerOf(path);

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
