import * as vscode from "vscode";

const CONFIG = "contentLocalePair";

interface GroupConfig {
  viewGroupId: number;
  rootFolder: string;
  fileRegex: string;
}

type TemplatePart = { kind: "literal"; value: string } | { kind: "capture" };

/** Prevents re-entry while a split layout is being arranged. */
let arranging = false;

/** Reads extension settings from the workspace configuration. */
function settings() {
  const config = vscode.workspace.getConfiguration(CONFIG);
  return {
    enabled: config.get<boolean>("enabled", true),
    groups: config.get<GroupConfig[]>("groups", []),
    closePairOnClose: config.get<boolean>("closePairOnClose", true),
  };
}

/** Returns valid group configs, or null when fewer than two groups are configured. */
function validGroups(groups: readonly GroupConfig[]): GroupConfig[] | null {
  if (groups.length < 2) {
    return null;
  }

  const parsed: GroupConfig[] = [];
  const viewGroupIds = new Set<number>();

  for (const group of groups) {
    if (
      !Number.isInteger(group.viewGroupId) ||
      group.viewGroupId < 1 ||
      typeof group.rootFolder !== "string" ||
      group.rootFolder.trim().length === 0 ||
      typeof group.fileRegex !== "string" ||
      group.fileRegex === undefined
    ) {
      return null;
    }

    if (viewGroupIds.has(group.viewGroupId)) {
      return null;
    }

    try {
      new RegExp(group.fileRegex);
    } catch {
      return null;
    }

    viewGroupIds.add(group.viewGroupId);
    parsed.push({
      viewGroupId: group.viewGroupId,
      rootFolder: group.rootFolder.trim(),
      fileRegex: group.fileRegex,
    });
  }

  return parsed;
}

/** Splits a path regex into literal segments and capture-group placeholders. */
function decomposePathRegex(pathRegex: string): TemplatePart[] | null {
  const source = pathRegex.replace(/^\^/, "").replace(/\$$/, "");
  const parts: TemplatePart[] = [];
  let literal = "";
  let i = 0;

  while (i < source.length) {
    if (source[i] === "\\") {
      if (i + 1 >= source.length) {
        return null;
      }
      literal += source[i + 1];
      i += 2;
      continue;
    }

    if (source[i] !== "(") {
      literal += source[i];
      i++;
      continue;
    }

    if (literal) {
      parts.push({ kind: "literal", value: literal });
      literal = "";
    }

    if (source.slice(i, i + 3) === "(?:") {
      return null;
    }

    if (source.slice(i, i + 3) === "(?<") {
      const closeAngle = source.indexOf(">", i);
      if (closeAngle === -1) {
        return null;
      }
      i = closeAngle + 1;
    } else {
      i++;
    }

    parts.push({ kind: "capture" });

    let depth = 1;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") {
        depth++;
      }
      if (source[i] === ")") {
        depth--;
      }
      i++;
    }
  }

  if (literal) {
    parts.push({ kind: "literal", value: literal });
  }

  return parts.some((part) => part.kind === "capture") ? parts : null;
}

/** Rebuilds a file path from a template and captured regex groups. */
function buildPathFromTemplate(
  parts: readonly TemplatePart[],
  captures: readonly string[],
): string {
  let path = "";
  let captureIndex = 0;

  for (const part of parts) {
    if (part.kind === "literal") {
      path += part.value;
      continue;
    }

    path += captures[captureIndex] ?? "";
    captureIndex++;
  }

  return path;
}

/** Rebuilds a group-relative file path by substituting a stem into the fileRegex capture groups. */
function buildGroupRelativePath(
  fileRegex: string,
  groupRelativeStem: string,
): string | null {
  const template = decomposePathRegex(fileRegex);
  if (!template) {
    return null;
  }

  return buildPathFromTemplate(template, [groupRelativeStem]);
}

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
    viewColumn: resolveOpenViewColumn(column),
    preserveFocus: !focus,
    preview: false,
  });
}

/**
 * When the active editor matches a configured group, opens the paired files in
 * their view groups.
 */
async function openCorrespondingFiles(editor: vscode.TextEditor | undefined): Promise<void> {
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

function getCorrespondingFiles(
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

/**
 * Closes paired tabs in other view groups when one side of the pair is closed,
 * unless `closePairOnClose` is disabled.
 */
async function closeCounterpart(closedPath: string): Promise<void> {
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
