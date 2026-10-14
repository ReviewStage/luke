import type { IntegrationToolAnnotations } from "@sidecar/features/integration-wire";
import type { IntegrationTool } from "./integration-health";

/**
 * integration-tool-model.ts -- how a list of an integration's tools orders them and badges each, in the MCP popover and Settings alike.
 *
 * The tools are one list in alphabetical order of their names. A badge comes
 * from the server's own `ToolAnnotations` (`@sidecar/features/integration-wire`),
 * the MCP spec's field for them, and from nothing else: Read-only where it
 * sent `readOnlyHint`, Destructive where it sent `destructiveHint` on a tool
 * it did not mark read-only, which is the only case the spec reads that hint
 * in; a tool it annotated with neither, or not at all, has no badge, and none
 * is ever guessed from a name.
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
