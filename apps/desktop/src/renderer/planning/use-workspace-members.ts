import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act";

/**
 * use-workspace-members.ts -- a workspace's members as a place that draws them holds them: the plan's crumb, and a plan's version history.
 *
 * The members are read once per workspace the place stands in, and again
 * whenever the workspace's own count changes, as a member joining or leaving
 * changes it. Until they answer, or if they never do, the place has none, and
 * draws what it can without them: a count alone, or a teammate's letter where
 * their picture would stand. Each place reads for itself; a version history
 * and the crumb never stand at once, since the history takes the window.
 */

/** A workspace's members, read again whenever its count changes; none while unread, refused, or for no workspace. */
export function useWorkspaceMembers(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): readonly WorkspaceMember[] | undefined {
  const { act } = useAct();
  const [read, setRead] = useState<{
    workspaceId: string;
    members: readonly WorkspaceMember[];
  }>();
  const workspaceId = workspace?.id;
  const memberCount = workspace?.memberCount;
  // A changed count reads the members again by standing among the effect's dependencies.
  useEffect(() => {
    if (workspaceId === undefined) return;
    let live = true;
    act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }).then(
      (members) => {
        if (live) setRead({ workspaceId, members });
      },
      // Note that a refused read leaves the place as it stands, because it draws what it can without the members.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, memberCount]);
  return read !== undefined && read.workspaceId === workspaceId ? read.members : undefined;
}
