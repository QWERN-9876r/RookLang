import { join } from 'node:path';
import {
  StatusBarAlignment,
  window,
  workspace,
  type ExtensionContext,
  type StatusBarItem,
} from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import { offerUpdate, outdated } from './outdated.mts';
import { VERSION } from './versions.mts';

// The extension starts the language server (server.mts) for `.rk` files, tells it whether the
// workspace is trusted, so that it may run the compiler installed there, and shows in the status
// bar which compiler checked the file being edited. An installed compiler older than its own copy
// is marked there, and the extension offers to update it (outdated.mts).

let client: LanguageClient | undefined;

/** What the server sends after a check: the installed compiler, or null for its own copy. */
interface CompilerOfFile {
  uri: string;
  installed: { version: string; path: string } | null;
}

export async function activate(context: ExtensionContext): Promise<void> {
  const module = context.asAbsolutePath(join('dist', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    // "Attach to Node Process" on port 6009 debugs the server.
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ['--inspect=6009'] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: 'rook' }],
    // Changes on disk of the modules and the CSS a file imports.
    synchronize: { fileEvents: workspace.createFileSystemWatcher('**/*.{rk,css}') },
    initializationOptions: { trusted: workspace.isTrusted },
  };
  const status = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  const compilers = new Map<string, CompilerOfFile['installed']>();
  // A new rooklang has been installed: the server loads it when it checks the files again.
  const recheck = () => void client?.sendNotification('rook/recheck');

  client = new LanguageClient('rook', 'Rook', serverOptions, clientOptions);
  context.subscriptions.push(
    status,
    workspace.onDidGrantWorkspaceTrust(() => void client?.sendNotification('rook/trusted')),
    window.onDidChangeActiveTextEditor(() => showCompiler(status, compilers)),
    workspace.onDidCloseTextDocument((document) => compilers.delete(document.uri.toString())),
  );
  client.onNotification('rook/compiler', ({ uri, installed }: CompilerOfFile) => {
    compilers.set(uri, installed);
    showCompiler(status, compilers);
    if (installed) offerUpdate(context, installed, recheck);
  });
  await client.start();
}

/** The compiler of the file being edited, if it is a Rook file that has been checked. */
function showCompiler(
  status: StatusBarItem,
  compilers: Map<string, CompilerOfFile['installed']>,
): void {
  const uri = window.activeTextEditor?.document.uri.toString();

  if (uri === undefined || !compilers.has(uri)) {
    status.hide();

    return;
  }

  const installed = compilers.get(uri);
  const old = installed ? outdated(installed) : false;

  status.text = installed
    ? `${old ? '$(warning) ' : ''}Rook ${installed.version}`
    : 'Rook (built-in)';
  status.tooltip = installed
    ? `Checked by rooklang ${installed.version} of ${installed.path}` +
      (old ? `, older than the ${VERSION} of the extension: newer syntax shows as errors` : '')
    : workspace.isTrusted
      ? 'Checked by the compiler of the extension: no node_modules/rooklang next to the file'
      : 'Checked by the compiler of the extension: the workspace is not trusted';
  status.show();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
