/**
 * cli-workspace.ts -- which workspace a `vespin` command acts in, from what the command line, the environment, and the config name, and the member's own workspaces.
 *
 * The order is the command line's over the shell's over the machine's: the
 * `-w` flag, then `VESPIN_WORKSPACE`, then the default the config keeps for
 * the service, and only where none names one, the member's one workspace
 * if they have exactly one. A workspace is named by its id or its slug,
 * read as a link's is (`workspaceOfSlug`), so a slug it stood under before
 * still names it. A name that matches none of the member's workspaces is
 * never passed over for the next one in line, since the person asked for it.
 */

import { type Workspace, workspaceOfSlug } from "./workspace-wire.js";

/** Where the workspace a command acts in was named. */
export const CLI_WORKSPACE_SOURCE = {
  FLAG: "flag",
  ENVIRONMENT: "environment",
  CONFIG: "config",
  ONLY: "only",
} as const;

export type CliWorkspaceSource = (typeof CLI_WORKSPACE_SOURCE)[keyof typeof CLI_WORKSPACE_SOURCE];

/** Why no workspace was settled on: one was named that the member is not in, or none was named and they have several, or none. */
export const CLI_WORKSPACE_UNSETTLED = {
  UNKNOWN: "unknown",
  UNNAMED: "unnamed",
} as const;

type CliWorkspaceUnsettled = (typeof CLI_WORKSPACE_UNSETTLED)[keyof typeof CLI_WORKSPACE_UNSETTLED];

/** What each place names, where it names anything. */
export interface CliWorkspaceNames {
  readonly flag?: string | undefined;
  readonly environment?: string | undefined;
  readonly config?: string | undefined;
}

export type CliWorkspaceResolution<Listed> =
  | { readonly workspace: Listed; readonly source: CliWorkspaceSource }
  | {
      readonly unsettled: CliWorkspaceUnsettled;
      /** The name that matched nothing, and where it came from. */
      readonly named?: { readonly name: string; readonly source: CliWorkspaceSource };
    };

/** The workspace a command acts in among the member's own, or why none was settled on. */
export function resolveCliWorkspace<Listed extends Pick<Workspace, "id" | "slug" | "formerSlugs">>(
  names: CliWorkspaceNames,
  workspaces: readonly Listed[],
): CliWorkspaceResolution<Listed> {
  const named =
    names.flag !== undefined
      ? { name: names.flag, source: CLI_WORKSPACE_SOURCE.FLAG }
      : names.environment !== undefined
        ? { name: names.environment, source: CLI_WORKSPACE_SOURCE.ENVIRONMENT }
        : names.config !== undefined
          ? { name: names.config, source: CLI_WORKSPACE_SOURCE.CONFIG }
          : undefined;
  if (named !== undefined) {
    const workspace = workspaceOfSlug(workspaces, named.name);
    return workspace === undefined
      ? { unsettled: CLI_WORKSPACE_UNSETTLED.UNKNOWN, named }
      : { workspace, source: named.source };
  }
  const [only, ...others] = workspaces;
  return only !== undefined && others.length === 0
    ? { workspace: only, source: CLI_WORKSPACE_SOURCE.ONLY }
    : { unsettled: CLI_WORKSPACE_UNSETTLED.UNNAMED };
}
