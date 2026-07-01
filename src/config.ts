import * as vscode from "vscode";
import { GroupConfig } from "./types";

const CONFIG = "contentLocalePair";

/** Reads extension settings from the workspace configuration. */
export function settings() {
  const config = vscode.workspace.getConfiguration(CONFIG);
  return {
    enabled: config.get<boolean>("enabled", true),
    groups: config.get<GroupConfig[]>("groups", []),
    closePairOnClose: config.get<boolean>("closePairOnClose", true),
  };
}

/** Returns valid group configs, or null when fewer than two groups are configured. */
export function validGroups(groups: readonly GroupConfig[]): GroupConfig[] | null {
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
