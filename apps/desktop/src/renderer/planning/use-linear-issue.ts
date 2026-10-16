import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";

/**
 * use-linear-issue.ts -- a Linear issue a link in Luke's words names, as its chip says it: its title and the state it stands in, read through the workspace's own Linear.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one their mentions are written under. The issue is read
 * once per chip, by its identifier, through the workspace's grant on the
 * service, and only where that workspace has Linear connected, so a chip in
 * a workspace without it asks nothing. Until it answers, or where it never
 * does, the chip says what the address says, as it always has.
 */

/** Where the words a chip stands in are: the plan's id, or none off a plan, and the workspace's slug its mentions are written under. */
export interface ChipWhere {
  readonly planId: string;
  readonly workspace: string;
}

/** The issue `identifier` names, through the Linear of the workspace `where` stands in; none while unread, refused, unconnected, or with no identifier. */
export function useLinearIssue(
  identifier: string | undefined,
  where: ChipWhere,
): LinearIssueSummary | undefined {
  const { act } = useAct();
  const planning = useAppState()?.planning;
  const workspaceId =
    planning?.plans.find((plan) => plan.id === where.planId)?.workspaceId ??
    planning?.workspaces.find((workspace) => workspace.slug === where.workspace)?.id;
  const connected =
    planning?.workspaces.find((workspace) => workspace.id === workspaceId)?.linear?.active === true;
  const [read, setRead] = useState<{ identifier: string; issue: LinearIssueSummary }>();
  useEffect(() => {
    if (identifier === undefined || workspaceId === undefined || !connected) return;
    let live = true;
    act(ACT_KIND.WORKSPACE_LINEAR_ISSUES, { workspaceId, identifier }).then(
      ([issue]) => {
        if (live && issue !== undefined) setRead({ identifier, issue });
      },
      // Note that a refused read leaves the chip as the address says it, which is how it always stood.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, identifier, workspaceId, connected]);
  return read !== undefined && read.identifier === identifier ? read.issue : undefined;
}
