import * as vscode from "vscode";
import { buildGroupRelativePath } from "./pathTemplate";
import { GroupConfig } from "./types";

function isPathInGroup(relativePath: string, group: GroupConfig): boolean {
  if (!relativePath.startsWith(group.rootFolder)) {
    return false;
  }

  const groupRelativePath = relativePath
    .slice(group.rootFolder.length)
    .replace(/^[/\\]/, "");

  return new RegExp(group.fileRegex).test(groupRelativePath);
}

function getPathGroupId(relativePath: string, groups: readonly GroupConfig[]): GroupConfig | undefined {
  for (const group of groups) {
    if (isPathInGroup(relativePath, group)) {
      return group;
    }
  }
  return undefined;
}

function getGroupRelativeStem(workspaceRelativePath: string, group: GroupConfig): string | undefined {
  const groupRelativePath = workspaceRelativePath
    .slice(group.rootFolder.length)
    .replace(/^[/\\]/, "");
  return new RegExp(group.fileRegex).exec(groupRelativePath)?.[1];
}

function workspaceRelativeToFsPath(
  workspaceRelativePath: string,
  editor: vscode.TextEditor,
): string | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    return undefined;
  }

  const segments = workspaceRelativePath.split(/[/\\]/).filter(Boolean);
  return vscode.Uri.joinPath(workspaceFolder.uri, ...segments).fsPath;
}

export function getCorrespondingFiles(
  workspaceRelativePath: string,
  groups: readonly GroupConfig[],
  editor: vscode.TextEditor,
): { group: GroupConfig; absoluteFilePath: string }[] {
  const fileGroup = getPathGroupId(workspaceRelativePath, groups);
  if (!fileGroup) {
    return [];
  }

  const groupRelativeStem = getGroupRelativeStem(workspaceRelativePath, fileGroup);
  if (!groupRelativeStem) {
    return [];
  }

  const correspondingFiles: { group: GroupConfig; absoluteFilePath: string }[] = [];
  for (const group of groups) {
    const counterpartRelativePath = buildGroupRelativePath(group.fileRegex, groupRelativeStem);
    if (!counterpartRelativePath) {
      continue;
    }

    const counterpartWorkspaceRelativePath = `${group.rootFolder}${counterpartRelativePath}`;
    const absoluteFilePath = workspaceRelativeToFsPath(
      counterpartWorkspaceRelativePath,
      editor,
    );
    if (!absoluteFilePath) {
      continue;
    }

    correspondingFiles.push({ group, absoluteFilePath });
  }
  return correspondingFiles;
}
