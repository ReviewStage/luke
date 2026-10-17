import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act";

/**
 * use-workspace-members.ts -- a workspace's members as a place that draws them holds them: the task's member directory, the command palette, and a plan's version history.
 *
 * The members are read once per workspace the place stands in, and again
 * whenever the workspace's own count changes, as a member joining or leaving
 * changes it. Until they answer, or if they never do, the place has none, and
 * draws what it can without them: a count alone, or a teammate's letter where
 * their picture would stand. A read taken before the count last changed is
 * no longer handed on, so nobody who joined since is taken for gone. Each place reads for itself.
 */

/** A workspace's members, read again whenever its count changes; none while unread, refused, or for no workspace. */
export function useWorkspaceMembers(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): readonly WorkspaceMember[] | undefined {
  const { act } = useAct();
  const [read, setRead] = useState<{
    workspaceId: string;
    memberCount: number | undefined;
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
        if (live) setRead({ workspaceId, memberCount, members });
      },
      // Note that a refused read leaves the place as it stands, because it draws what it can without the members.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, memberCount]);
  // Note that a read taken at another count is not handed on, because a member it misses would be drawn as having left while a newer read is out, or after one failed.
  const current =
    read !== undefined && read.workspaceId === workspaceId && read.memberCount === memberCount;
  return current ? read.members : undefined;
}

/**
 * Who a workspace's work names but who left it, read as its members are, and
 * again whenever its count changes; none while unread, refused, from a
 * service that names nobody, or for no workspace. Note that a read that
 * failed leaves them unread, since someone who left still stands grayed by
 * their letter without their picture.
 */
export function useFormerMembers(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): readonly FormerMember[] | undefined {
  const { act } = useAct();
  const [read, setRead] = useState<{
    workspaceId: string;
    memberCount: number | undefined;
    former: readonly FormerMember[];
  }>();
  const workspaceId = workspace?.id;
  const memberCount = workspace?.memberCount;
  useEffect(() => {
    if (workspaceId === undefined) return;
    let live = true;
    act(ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, { workspaceId }).then(
      (former) => {
        if (live) setRead({ workspaceId, memberCount, former });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, memberCount]);
  const current =
    read !== undefined && read.workspaceId === workspaceId && read.memberCount === memberCount;
  return current ? read.former : undefined;
}
