import { TemplatePart } from "./types";

/** Splits a path regex into literal segments and capture-group placeholders. */
export function decomposePathRegex(pathRegex: string): TemplatePart[] | null {
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
export function buildPathFromTemplate(
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
export function buildGroupRelativePath(
  fileRegex: string,
  groupRelativeStem: string,
): string | null {
  const template = decomposePathRegex(fileRegex);
  if (!template) {
    return null;
  }

  return buildPathFromTemplate(template, [groupRelativeStem]);
}
