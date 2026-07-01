import * as vscode from "vscode";
import { settings, validGroups } from "./config";
import { openInColumn } from "./editor";
import { getCorrespondingFiles } from "./pairing";

/** Prevents re-entry while a split layout is being arranged. */
let arranging = false;

/**
 * When the active editor matches a configured group, opens the paired files in
 * their view groups.
 */
export async function openCorrespondingFiles(editor: vscode.TextEditor | undefined): Promise<void> {
  const { enabled, groups } = settings();
  const configuredGroups = validGroups(groups);
  if (!enabled || !editor || arranging || !configuredGroups) {
    return;
  }

  const focusedWorkspaceRelativePath = vscode.workspace.asRelativePath(
    editor.document.uri.fsPath,
  );
  const correspondingFiles = getCorrespondingFiles(
    focusedWorkspaceRelativePath,
    configuredGroups,
    editor,
  );
  if (correspondingFiles.length === 0) {
    return;
  }

  arranging = true;
  try {
    for (const { absoluteFilePath, group } of correspondingFiles) {
      for (const tabGroup of vscode.window.tabGroups.all) {
        let found = false;
        for (const tab of tabGroup.tabs) {
          if (!(tab.input instanceof vscode.TabInputText)) {
            continue;
          }

          if (tab.input.uri.fsPath !== absoluteFilePath) {
            continue;
          }

          if (tabGroup.viewColumn === group.viewGroupId as vscode.ViewColumn) {
            found = true;
            break;
          }
          console.log("closing tab", tab.input.uri.fsPath, "in group", tabGroup.viewColumn);
          await vscode.window.tabGroups.close(tab);
        }

        if (!found && tabGroup.viewColumn === group.viewGroupId as vscode.ViewColumn) {
          console.log("opening tab", absoluteFilePath, "in group", group.viewGroupId);
          await openInColumn(absoluteFilePath, group.viewGroupId as vscode.ViewColumn, false);
        }
      }
    }
  } finally {
    arranging = false;
  }
}

/**
 * Closes paired tabs in other view groups when one side of the pair is closed,
 * unless `closePairOnClose` is disabled.
 */
export async function closeCounterpart(closedPath: string): Promise<void> {
  const { enabled, groups, closePairOnClose } = settings();
  const configuredGroups = validGroups(groups);
  if (!enabled || arranging || !closePairOnClose || !configuredGroups) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const closedFileWorkspaceRelativePath = vscode.workspace.asRelativePath(closedPath);
  const correspondingFiles = getCorrespondingFiles(
    closedFileWorkspaceRelativePath,
    configuredGroups,
    editor,
  );
  if (correspondingFiles.length === 0) {
    return;
  }

  arranging = true;
  try {
    for (const { absoluteFilePath } of correspondingFiles) {
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          if (
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.fsPath === absoluteFilePath
          ) {
            console.log("closing tab", tab.input.uri.fsPath, "in group", tabGroup.viewColumn);
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    }
  } finally {
    arranging = false;
  }
}
