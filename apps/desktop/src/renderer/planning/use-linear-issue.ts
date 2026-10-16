import type { LinearIssueSummary } from "@luke/features/linear-wire";
import type { PlanningView } from "@luke/features/planning-view";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";

/**
 * use-linear-issue.ts -- a Linear issue a link in Luke's words names, as its chip says it: its title and the state it stands in, read through the workspace's own Linear.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one their mentions are written under. Words that name
 * neither, as the window's own Inbox draws an item's, read nothing, since
 * an issue read through another workspace's Linear would be drawn in the
 * wrong one. The issue is read
 * once per chip, by its identifier, through the workspace's grant on the
 * service, and only where that workspace has Linear connected, so a chip in
 * a workspace without it asks nothing. Until it answers, or where it never
 * does, the chip says what the address says, as it always has, and an
 * answer is held to the workspace it was read through and the connection it
 * was read over, so a workspace that disconnects Linear stops drawing it.
 */

/** Where the words a chip stands in are: the plan's id, or none off a plan, and the workspace's slug its mentions are written under. */
export interface ChipWhere {
  readonly planId: string;
  readonly workspace: string;
}

/** The workspace the words a chip stands in are of: the plan's, else the one their mentions are written under; none where they name neither. */
function wordsWorkspace(
  planning: PlanningView | undefined,
  where: ChipWhere,
): Workspace | undefined {
  const workspaces = planning?.workspaces ?? [];
  const planWorkspaceId = planning?.plans.find((plan) => plan.id === where.planId)?.workspaceId;
  return (
    workspaces.find((each) => each.id === planWorkspaceId) ??
    workspaces.find((each) => each.slug === where.workspace)
  );
}

/** The issue `identifier` names, through the Linear of the workspace `where` stands in; none while unread, refused, unconnected, or with no identifier. */
export function useLinearIssue(
  identifier: string | undefined,
  where: ChipWhere,
): LinearIssueSummary | undefined {
  const { act } = useAct();
  const workspace = wordsWorkspace(useAppState()?.planning, where);
  const workspaceId = workspace?.id;
  const connected = workspace?.linear?.active === true;
  const [read, setRead] = useState<{
    workspaceId: string;
    identifier: string;
    issue: LinearIssueSummary;
  }>();
  useEffect(() => {
    if (identifier === undefined || workspaceId === undefined || !connected) return;
    let live = true;
    act(ACT_KIND.WORKSPACE_LINEAR_ISSUES, { workspaceId, identifier }).then(
      ([issue]) => {
        if (live && issue !== undefined) setRead({ workspaceId, identifier, issue });
      },
      // Note that a refused read leaves the chip as the address says it, which is how it always stood.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, identifier, workspaceId, connected]);
  // Note that an answer stands only for the workspace and the connection it was read through, so a disconnect or another workspace drops it at once.
  const current =
    connected &&
    read !== undefined &&
    read.workspaceId === workspaceId &&
    read.identifier === identifier;
  return current ? read.issue : undefined;
}
