import type { IntegrationTool } from "./integration-health.js";
import type { IntegrationToolAnnotations, IntegrationToolParameter } from "./integration-wire.js";

/**
 * integration-tool-model.ts -- how a list of an integration's tools orders, names, and badges each, and what a tool's page says of it, in the MCP popover and Settings alike.
 *
 * The tools are one list in alphabetical order of their names. A tool is
 * called by the title its server gave it where it gave one, and by its name
 * otherwise, and its row reads the first sentence of what it does. A badge
 * comes from the server's own `ToolAnnotations`
 * (`@luke/features/integration-wire`), the MCP spec's field for them, and
 * from nothing else: Read-only where it sent `readOnlyHint`, Destructive
 * where it sent `destructiveHint` on a tool it did not mark read-only, which
 * is the only case the spec reads that hint in; a tool it annotated with
 * neither, or not at all, has no badge, and none is ever guessed from a
 * name. A tool's page says every hint its server sent, the badge's first,
 * and nothing of a hint it did not send: that it only adds where it marked
 * the tool neither read-only nor destructive, that it is safe to retry where
 * it marked a tool that writes idempotent, and whether it reaches outside
 * the integration or keeps to its own data where it said which. Its
 * parameters stand with those a call must give first.
 */

/** The badges a tool may wear, from its server's annotations. */
export const TOOL_BADGE = {
  READ_ONLY: "Read-only",
  DESTRUCTIVE: "Destructive",
} as const;

export type ToolBadge = (typeof TOOL_BADGE)[keyof typeof TOOL_BADGE];

/** Tools in alphabetical order of their names. */
export function byName(tools: readonly IntegrationTool[]): readonly IntegrationTool[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

/** The badge a tool's annotations earn it, where its server sent one that does. */
export function toolBadge(
  annotations: IntegrationToolAnnotations | undefined,
): ToolBadge | undefined {
  if (annotations?.readOnlyHint === true) return TOOL_BADGE.READ_ONLY;
  if (annotations?.destructiveHint === true) return TOOL_BADGE.DESTRUCTIVE;
  return undefined;
}

/** What a tool's page says its server's hints are, the badge's words among them. */
export const TOOL_HINT = {
  READ_ONLY: "read-only",
  DESTRUCTIVE: "destructive",
  ADDITIVE: "additive",
  IDEMPOTENT: "idempotent",
  OPEN_WORLD: "open-world",
  CLOSED_WORLD: "closed-world",
} as const;

export type ToolHint = (typeof TOOL_HINT)[keyof typeof TOOL_HINT];

/** The hints a tool's page says, in the order a reader weighs them: what it changes, then how far it reaches. */
export function toolHints(
  annotations: IntegrationToolAnnotations | undefined,
): readonly ToolHint[] {
  if (annotations === undefined) return [];
  const hints: ToolHint[] = [];
  if (annotations.readOnlyHint === true) hints.push(TOOL_HINT.READ_ONLY);
  else {
    // Note that the spec reads a write's hints only on a tool not marked read-only.
    if (annotations.destructiveHint === true) hints.push(TOOL_HINT.DESTRUCTIVE);
    if (annotations.readOnlyHint === false && annotations.destructiveHint === false)
      hints.push(TOOL_HINT.ADDITIVE);
    if (annotations.idempotentHint === true) hints.push(TOOL_HINT.IDEMPOTENT);
  }
  if (annotations.openWorldHint === true) hints.push(TOOL_HINT.OPEN_WORLD);
  if (annotations.openWorldHint === false) hints.push(TOOL_HINT.CLOSED_WORLD);
  return hints;
}

/** How a tool's page words a hint of `server`'s. */
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

/** What a tool is called: the title its server gave it, else its name. */
export function toolTitle(tool: { readonly name: string; readonly title?: string }): string {
  const title = tool.title?.trim() ?? "";
  return title === "" ? tool.name : title;
}

/** Markdown's marks in a run of words: code ticks, emphasis, and a link's brackets. */
const INLINE_MARKS = /`([^`]*)`|\*\*([^*]*)\*\*|\*([^*]*)\*|\[([^\]]*)\]\([^)]*\)/g;

/** A line that opens a block a row does not read from: a heading, a table, a list item, a quote, or raw markup. */
const STRUCTURE_LINE = /^(#|\||[-*+] |\d+[.)] |>|<)/;

/**
 * What a row reads of a description: the first sentence of its first
 * paragraph of words, every heading, table, list, quote, and fenced block
 * before it passed over line by line, so a heading standing right on top of
 * its paragraph does not take the paragraph with it, and markdown's marks
 * taken off.
 */
export function toolSummary(description: string): string {
  const paragraph: string[] = [];
  let fenced = false;
  for (const line of description.split(/\r?\n/).map((each) => each.trim())) {
    const fence = line.startsWith("```");
    const structure = fence || line === "" || STRUCTURE_LINE.test(line);
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

/** A tool's parameters with those a call must give first, each half in its server's order. */
export function requiredFirst(
  parameters: readonly IntegrationToolParameter[],
): readonly IntegrationToolParameter[] {
  return [
    ...parameters.filter((parameter) => parameter.required),
    ...parameters.filter((parameter) => !parameter.required),
  ];
}
