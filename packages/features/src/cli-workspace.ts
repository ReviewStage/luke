import { type Workspace, workspaceOfSlug } from "./workspace-wire.js";

export const CLI_WORKSPACE_SOURCE = {
  FLAG: "flag",
  ENVIRONMENT: "environment",
  CONFIG: "config",
  ONLY: "only",
} as const;

export type CliWorkspaceSource = (typeof CLI_WORKSPACE_SOURCE)[keyof typeof CLI_WORKSPACE_SOURCE];

export const CLI_WORKSPACE_UNSETTLED = {
  UNKNOWN: "unknown",
  UNNAMED: "unnamed",
} as const;

type CliWorkspaceUnsettled = (typeof CLI_WORKSPACE_UNSETTLED)[keyof typeof CLI_WORKSPACE_UNSETTLED];

export interface CliWorkspaceNames {
  readonly flag?: string | undefined;
  readonly environment?: string | undefined;
  readonly config?: string | undefined;
}

export type CliWorkspaceResolution<Listed> =
  | { readonly workspace: Listed; readonly source: CliWorkspaceSource }
  | {
      readonly unsettled: CliWorkspaceUnsettled;
      readonly named?: { readonly name: string; readonly source: CliWorkspaceSource };
    };

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
