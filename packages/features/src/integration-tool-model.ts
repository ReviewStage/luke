import type { IntegrationTool } from "./integration-health.js";
import type { IntegrationToolAnnotations, IntegrationToolParameter } from "./integration-wire.js";

export const TOOL_BADGE = {
  READ_ONLY: "Read-only",
  DESTRUCTIVE: "Destructive",
} as const;

export type ToolBadge = (typeof TOOL_BADGE)[keyof typeof TOOL_BADGE];

export function byName(tools: readonly IntegrationTool[]): readonly IntegrationTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

export function toolBadge(
  annotations: IntegrationToolAnnotations | undefined,
): ToolBadge | undefined {
  if (annotations?.readOnlyHint === true) return TOOL_BADGE.READ_ONLY;
  if (annotations?.destructiveHint === true) return TOOL_BADGE.DESTRUCTIVE;
  return undefined;
}

export const TOOL_HINT = {
  READ_ONLY: "read-only",
  DESTRUCTIVE: "destructive",
  ADDITIVE: "additive",
  IDEMPOTENT: "idempotent",
  OPEN_WORLD: "open-world",
  CLOSED_WORLD: "closed-world",
} as const;

export type ToolHint = (typeof TOOL_HINT)[keyof typeof TOOL_HINT];

export function toolHints(
  annotations: IntegrationToolAnnotations | undefined,
): readonly ToolHint[] {
  if (annotations === undefined) return [];
  const hints: ToolHint[] = [];
  if (annotations.readOnlyHint === true) hints.push(TOOL_HINT.READ_ONLY);
  else {
    if (annotations.destructiveHint === true) hints.push(TOOL_HINT.DESTRUCTIVE);
    if (annotations.readOnlyHint === false && annotations.destructiveHint === false)
      hints.push(TOOL_HINT.ADDITIVE);
    if (annotations.idempotentHint === true) hints.push(TOOL_HINT.IDEMPOTENT);
  }
  if (annotations.openWorldHint === true) hints.push(TOOL_HINT.OPEN_WORLD);
  if (annotations.openWorldHint === false) hints.push(TOOL_HINT.CLOSED_WORLD);
  return hints;
}

export function toolHintWords(hint: ToolHint, server: string): string {
  switch (hint) {
    case TOOL_HINT.READ_ONLY:
      return TOOL_BADGE.READ_ONLY;
    case TOOL_HINT.DESTRUCTIVE:
      return TOOL_BADGE.DESTRUCTIVE;
    case TOOL_HINT.ADDITIVE:
      return "Only adds, never deletes";
    case TOOL_HINT.IDEMPOTENT:
      return "Safe to retry";
    case TOOL_HINT.OPEN_WORLD:
      return `Reaches outside ${server}`;
    case TOOL_HINT.CLOSED_WORLD:
      return `Only ${server}'s own data`;
  }
}

export function toolTitle(tool: { readonly name: string; readonly title?: string }): string {
  const title = tool.title?.trim() ?? "";
  return title === "" ? tool.name : title;
}

const INLINE_MARKS =
  /`([^`]*)`|\*\*([^*]*)\*\*|\*([^*]*)\*|\[([^[\]]*)\]\((?:[^()[\]\s]|\([^()[\]\s]*\))*\)/g;

const STRUCTURE_LINE = /^(#|\||[-*+] |\d+[.)] |>|<)/;

const RULE_LINE = /^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/;

export function toolSummary(description: string): string {
  const paragraph: string[] = [];
  let fenced = false;
  for (const line of description.split(/\r?\n/).map((each) => each.trim())) {
    const fence = line.startsWith("```");
    const structure = fence || line === "" || STRUCTURE_LINE.test(line) || RULE_LINE.test(line);
    if (fence) fenced = !fenced;
    if (paragraph.length > 0 && (structure || fenced)) break;
    if (!structure && !fenced) paragraph.push(line);
  }
  const plain = paragraph
    .join(" ")
    .replace(
      INLINE_MARKS,
      (_mark, code, strong, emphasis, link) => code ?? strong ?? emphasis ?? link ?? "",
    )
    .replace(/\s+/g, " ");
  return plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
}

export function requiredFirst(
  parameters: readonly IntegrationToolParameter[],
): readonly IntegrationToolParameter[] {
  return [
    ...parameters.filter((parameter) => parameter.required),
    ...parameters.filter((parameter) => !parameter.required),
  ];
}
