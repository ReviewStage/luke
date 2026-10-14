import type { IntegrationToolAnnotations } from "@sidecar/hosted/integration-wire";
import type { IntegrationTool } from "../integration-health";

/**
 * server-tools-model.ts -- how a server's page in the MCP popover lists its tools: in alphabetical order, in runs by a shared name prefix where the names clearly share them, and each with the one badge its server's own annotations earn it.
 *
 * MCP gives a tool no category, so any grouping here is read off the names
 * alone and says so: a run's heading is the prefix its names share, drawn
 * as a pattern (`hiring.*`, `slack_search_*`), never as a category's name.
 * A server's names are run by prefix only where that clearly sorts them:
 * enough tools to want it, each run at least two, and nearly every tool in
 * one; a prefix every name shares is the server's own and sorts nothing,
 * so the runs are cut after it. Otherwise the tools are one alphabetical
 * list. A badge comes from the server's `ToolAnnotations` and from nothing
 * else (`@sidecar/hosted/integration-wire`): Read-only
 * where it sent `readOnlyHint`, Destructive where it sent
 * `destructiveHint` on a tool it did not mark read-only, which is the only
 * case the spec reads that hint in; a tool it annotated with neither, or
 * not at all, has no badge, and none is ever guessed from a name.
 */

/** The fewest tools a server lists before its names are run by prefix. */
const GROUPED_FROM_TOOLS = 10;

/** The fewest tools a run holds. */
const LEAST_PER_GROUP = 2;

/** The share of a server's tools the runs must hold between them for the prefixes to sort it clearly. */
const GROUPED_SHARE = 0.8;

/** Where one name splits into its parts: after each `.`, `_`, `-`, `/`, or `:`. */
const NAME_PARTS = /(?<=[._\-/:])/;

/** A run of tools, under the prefix their names share, or the rest under none. */
export interface ToolGroup {
  readonly prefix: string | undefined;
  readonly tools: readonly IntegrationTool[];
}

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

/** How many leading parts every one of the names shares, short of any name's last. */
function sharedParts(names: readonly (readonly string[])[]): number {
  const first = names[0] ?? [];
  let shared = 0;
  while (
    shared < first.length - 1 &&
    names.every((parts) => parts.length > shared + 1 && parts[shared] === first[shared])
  ) {
    shared += 1;
  }
  return shared;
}

/**
 * A server's tools as its page lists them: runs under each prefix their
 * names clearly share, in the prefixes' order, then the rest under none;
 * or, where the names share no clear prefixes, every tool under none.
 * Each run is in alphabetical order.
 */
export function toolGroups(tools: readonly IntegrationTool[]): readonly ToolGroup[] {
  const sorted = byName(tools);
  const flat = [{ prefix: undefined, tools: sorted }];
  if (sorted.length < GROUPED_FROM_TOOLS) return flat;
  const parts = sorted.map((tool) => tool.name.split(NAME_PARTS));
  const shared = sharedParts(parts);
  const runs = new Map<string, IntegrationTool[]>();
  sorted.forEach((tool, at) => {
    const own = parts[at] ?? [];
    // A name with nothing after its prefix's part is that part alone, a run of none.
    if (own.length <= shared + 1) return;
    const prefix = own.slice(0, shared + 1).join("");
    runs.set(prefix, [...(runs.get(prefix) ?? []), tool]);
  });
  const groups = [...runs]
    .filter(([, run]) => run.length >= LEAST_PER_GROUP)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, run]) => ({ prefix, tools: run }));
  const grouped = groups.reduce((sum, group) => sum + group.tools.length, 0);
  if (groups.length < 2 || grouped < sorted.length * GROUPED_SHARE) return flat;
  const inRuns = new Set(groups.flatMap((group) => group.tools));
  const rest = sorted.filter((tool) => !inRuns.has(tool));
  return rest.length === 0 ? groups : [...groups, { prefix: undefined, tools: rest }];
}

/** The badge a tool's annotations earn it, where its server sent one that does. */
export function toolBadge(
  annotations: IntegrationToolAnnotations | undefined,
): ToolBadge | undefined {
  if (annotations?.readOnlyHint === true) return TOOL_BADGE.READ_ONLY;
  if (annotations?.destructiveHint === true) return TOOL_BADGE.DESTRUCTIVE;
  return undefined;
}
