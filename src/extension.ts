import * as path from "node:path";
import * as vscode from "vscode";

const CONFIG = "contentLocalePair";

/** Prevents a recursive close when we close the counterpart tab programmatically. */
const suppressClosePair = new Set<string>();

/** Prevents re-entry while a split layout is being arranged. */
let arranging = false;

/** Reads extension settings from the workspace configuration. */
function settings() {
  const config = vscode.workspace.getConfiguration(CONFIG);
  return {
    enabled: config.get<boolean>("enabled", true),
    contentRoot: config.get<string>("contentRoot", "src/content"),
    locales: config.get<string[]>("locales", ["en", "cs"]),
    leftLocale: config.get<string>("leftLocale", "en"),
    closePairOnClose: config.get<boolean>("closePairOnClose", true),
  };
}

/**
 * Checks whether a file path belongs to a configured locale pair.
 * Returns both locale paths and the counterpart path, or null if the file
 * is not under `contentRoot/<locale>/...`.
 */
function parseLocaleFile(
  fsPath: string,
  contentRoot: string,
  locales: readonly string[],
) {
  if (locales.length !== 2) {
    return null;
  }

  const parts = fsPath.split(/[/\\]/);
  const rootParts = contentRoot.split(/[/\\]/).filter(Boolean);
  if (rootParts.length === 0) {
    return null;
  }

  for (let i = 0; i <= parts.length - rootParts.length - 2; i++) {
    if (!rootParts.every((segment, index) => parts[i + index] === segment)) {
      continue;
    }

    const localeIndex = i + rootParts.length;
    const locale = parts[localeIndex];
    if (!locales.includes(locale)) {
      return null;
    }

    const otherLocale = locales[0] === locale ? locales[1] : locales[0];
    const prefix = parts.slice(0, localeIndex).join(path.sep);
    const rest = parts.slice(localeIndex + 1).join(path.sep);
    const counterpart = path.join(prefix, otherLocale, rest);

    return {
      paths: {
        [locale]: fsPath,
        [otherLocale]: counterpart,
      },
      counterpart,
    };
  }

  return null;
}

/** Returns true when the given file is already open in the specified editor column. */
function inColumn(fsPath: string, column: vscode.ViewColumn): boolean {
  return vscode.window.visibleTextEditors.some(
    (editor) =>
      editor.document.uri.fsPath === fsPath && editor.viewColumn === column,
  );
}

/**
 * Opens a file in the requested column, creating an empty file first if needed.
 * When `focus` is false, the editor is opened without stealing keyboard focus.
 */
async function openInColumn(
  fsPath: string,
  column: vscode.ViewColumn,
  focus: boolean,
): Promise<void> {
  const uri = vscode.Uri.file(fsPath);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.alloc(0));
  }

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    viewColumn: column,
    preserveFocus: !focus,
    preview: false,
  });
}

/**
 * When the active editor is a locale file, opens its pair in a two-column split.
 * Respects `leftLocale` for column placement and skips work when the layout
 * is already correct or the extension is disabled.
 */
async function maybeOpenPair(editor: vscode.TextEditor | undefined): Promise<void> {
  const { enabled, contentRoot, locales, leftLocale } = settings();
  if (!enabled || !editor || arranging || !locales.includes(leftLocale)) {
    return;
  }

  const parsed = parseLocaleFile(
    editor.document.uri.fsPath,
    contentRoot,
    locales,
  );
  if (!parsed) {
    return;
  }

  const rightLocale = locales.find((locale) => locale !== leftLocale);
  if (!rightLocale) {
    return;
  }

  const left = parsed.paths[leftLocale];
  const right = parsed.paths[rightLocale];
  const source = editor.document.uri.fsPath;

  if (
    inColumn(left, vscode.ViewColumn.One) &&
    inColumn(right, vscode.ViewColumn.Two)
  ) {
    return;
  }

  arranging = true;
  try {
    await openInColumn(left, vscode.ViewColumn.One, source === left);
    await openInColumn(right, vscode.ViewColumn.Two, source === right);
  } finally {
    arranging = false;
  }
}

/**
 * Closes the paired locale tab when one side of the pair is closed,
 * unless `closePairOnClose` is disabled or the close was triggered by us.
 */
async function closeCounterpart(closedPath: string): Promise<void> {
  const { closePairOnClose, contentRoot, locales } = settings();
  if (!closePairOnClose || suppressClosePair.has(closedPath)) {
    return;
  }

  const parsed = parseLocaleFile(closedPath, contentRoot, locales);
  if (!parsed) {
    return;
  }

  const tab = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.fsPath === parsed.counterpart,
    );
  if (!tab) {
    return;
  }

  suppressClosePair.add(parsed.counterpart);
  try {
    await vscode.window.tabGroups.close(tab);
  } finally {
    suppressClosePair.delete(parsed.counterpart);
  }
}

/** Registers listeners that open locale pairs on activation and close them together. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void maybeOpenPair(editor);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      void closeCounterpart(document.uri.fsPath);
    }),
  );

  void maybeOpenPair(vscode.window.activeTextEditor);
}

export function deactivate(): void { }
