import * as vscode from "vscode";

function hasViewColumn(column: vscode.ViewColumn): boolean {
  return vscode.window.visibleTextEditors.some(
    (editor) => editor.viewColumn === column,
  );
}

/** Picks a view column that opens in the intended group, creating a split if needed. */
function resolveOpenViewColumn(targetColumn: vscode.ViewColumn): vscode.ViewColumn {
  if (hasViewColumn(targetColumn)) {
    return targetColumn;
  }

  if (targetColumn > vscode.ViewColumn.One) {
    return vscode.ViewColumn.Beside;
  }

  return targetColumn;
}

/**
 * Opens a file in the requested column, creating an empty file first if needed.
 * When `focus` is false, the editor is opened without stealing keyboard focus.
 */
export async function openInColumn(
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
    viewColumn: resolveOpenViewColumn(column),
    preserveFocus: !focus,
    preview: false,
  });
}
