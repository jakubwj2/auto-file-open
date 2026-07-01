import * as vscode from "vscode";
import { closeCounterpart, openCorrespondingFiles } from "./arrange";

/** Registers listeners that open locale pairs on activation and close them together. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void openCorrespondingFiles(editor);
    }),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        if (!(tab.input instanceof vscode.TabInputText)) {
          continue;
        }
        void closeCounterpart(tab.input.uri.fsPath);
      }
    }),
  );

  void openCorrespondingFiles(vscode.window.activeTextEditor);
}

export function deactivate(): void { }
