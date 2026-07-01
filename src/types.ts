export interface GroupConfig {
  viewGroupId: number;
  rootFolder: string;
  fileRegex: string;
}

export type TemplatePart = { kind: "literal"; value: string } | { kind: "capture" };
