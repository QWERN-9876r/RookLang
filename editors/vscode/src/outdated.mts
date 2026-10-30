import { ShellExecution, Task, TaskScope, tasks, window, type ExtensionContext } from 'vscode';
import { isOlder, updateCommand, VERSION } from './versions.mts';

// A project whose installed rooklang is older than the copy of the extension: its files are
// checked by that version, as `rook build` would build them, so newer syntax shows as errors. The
// extension says so once a session for each project and version, and offers to install the version
// it carries; "Don't Show Again" is kept until either version changes.

/** The projects already told about in this session: the path and the version installed there. */
const told = new Set<string>();
const UPDATE = 'Update';
const DISMISS = "Don't Show Again";

/** Whether the installed compiler is older than the copy of the extension. */
export function outdated(installed: { version: string }): boolean {
  return isOlder(installed.version, VERSION);
}

/** Offers to update the rooklang of a project; `updated` runs once the install has succeeded. */
export function offerUpdate(
  context: ExtensionContext,
  installed: { version: string; path: string },
  updated: () => void,
): void {
  const key = `rook.dismissedUpdate:${installed.path}`;
  const versions = `${installed.version}:${VERSION}`;

  if (!outdated(installed) || told.has(installed.path + versions)) return;
  told.add(installed.path + versions);
  if (context.globalState.get(key) === versions) return;

  const message =
    `This project checks Rook files with rooklang ${installed.version}, older than the ` +
    `${VERSION} of the extension: newer syntax shows as errors. Install rooklang ${VERSION}?`;

  void window.showWarningMessage(message, UPDATE, DISMISS).then((choice) => {
    if (choice === UPDATE) void update(installed.path, updated);
    if (choice === DISMISS) void context.globalState.update(key, versions);
  });
}

/** Installs the version of the extension in the project, as a task the terminal shows. */
async function update(installed: string, updated: () => void): Promise<void> {
  const { folder, command } = updateCommand(installed, VERSION);
  const task = new Task(
    { type: 'rook' },
    TaskScope.Workspace,
    `install rooklang ${VERSION}`,
    'Rook',
    new ShellExecution(command, { cwd: folder }),
  );
  const execution = await tasks.executeTask(task);
  const ended = tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== execution) return;
    ended.dispose();
    if (event.exitCode === 0) updated();
  });
}
