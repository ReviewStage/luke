import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";

/**
 * use-workspace-members.ts -- a workspace's members, and who left it, as a place that draws them holds them: the task's member directory, the command palette, and a plan's version history.
 *
 * The members are read once per workspace the place stands in, and again
 * whenever the workspace's own count changes, as a member joining or leaving
 * changes it. Until they answer, or if they never do, the place has none, and
 * draws what it can without them: a count alone, or a teammate's letter where
 * their picture would stand. A read taken before the count last changed is
 * no longer handed on, so nobody who joined since is taken for gone. Who
 * left is read the same way, on a read of its own. Each place reads for itself.
 */

/** A workspace's members as a place that says why it has none holds them: the members, whether the last read was refused, and a way to read them again. */
export interface WorkspaceMembersRead {
  /** The members, none while unread, refused, or for no workspace. */
  readonly members: readonly WorkspaceMember[] | undefined;
  /** Whether the read for the workspace at its count was refused, until another is asked for. */
  readonly refused: boolean;
  /** Reads the members again, standing unread until the read answers. */
  readonly retry: () => void;
}

/** Who left a workspace as a place that says why it has none holds them, as `WorkspaceMembersRead` holds the members. */
export interface FormerMembersRead {
  /** Who left, none while unread, refused, or for no workspace. */
  readonly former: readonly FormerMember[] | undefined;
  /** Whether the read for the workspace at its count was refused, until another is asked for. */
  readonly refused: boolean;
  /** Reads who left again, standing unread until the read answers. */
  readonly retry: () => void;
}

/** One read's answer, kept under the workspace and the count it was taken at. */
interface HeldRead<Row> {
  readonly workspaceId: string;
  readonly memberCount: number | undefined;
  /** Which retry it answers, so a refusal stands only until the next is asked for. */
  readonly asked: number;
  readonly rows: readonly Row[];
  readonly refused: boolean;
}

/** A list a workspace's count reads again, as one place holds it: the rows, none until they answer; whether the read was refused; and Retry. */
interface CountedRead<Row> {
  readonly rows: readonly Row[] | undefined;
  readonly refused: boolean;
  readonly retry: () => void;
}

/**
 * Reads a workspace's list with `read`, which must be stable, again whenever
 * its count changes or a retry asks, keeping whether the read was refused.
 */
function useCountedRead<Row>(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
  read: (workspaceId: string) => Promise<readonly Row[]>,
): CountedRead<Row> {
  const [held, setHeld] = useState<HeldRead<Row>>();
  const [asked, setAsked] = useState(0);
  const workspaceId = workspace?.id;
  const memberCount = workspace?.memberCount;
  // A changed count, or a retry, reads the list again by standing among the effect's dependencies.
  useEffect(() => {
    if (workspaceId === undefined) return;
    let live = true;
    const keep = (rows: readonly Row[], refused: boolean) => {
      if (live) setHeld({ workspaceId, memberCount, asked, rows, refused });
    };
    read(workspaceId).then(
      (rows) => keep(rows, false),
      () => keep([], true),
    );
    return () => {
      live = false;
    };
  }, [read, workspaceId, memberCount, asked]);
  const retry = useCallback(() => setAsked((count) => count + 1), []);
  // Note that a read taken at another count, or before a retry, is not handed on, because a member it misses would be drawn as having left while a newer read is out, or after one failed.
  const current =
    held !== undefined &&
    held.workspaceId === workspaceId &&
    held.memberCount === memberCount &&
    held.asked === asked;
  return {
    rows: current && !held.refused ? held.rows : undefined,
    refused: current && held.refused,
    retry,
  };
}

/** A workspace's members, read again whenever its count changes or a retry asks, with whether the read was refused. */
export function useWorkspaceMembersRead(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): WorkspaceMembersRead {
  const { act } = useAct();
  const read = useCallback(
    (workspaceId: string) => act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }),
    [act],
  );
  const { rows, refused, retry } = useCountedRead(workspace, read);
  return { members: rows, refused, retry };
}

/** A workspace's members, read again whenever its count changes; none while unread, refused, or for no workspace. */
export function useWorkspaceMembers(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): readonly WorkspaceMember[] | undefined {
  // Note that a refused read leaves the place as it stands, because it draws what it can without the members.
  return useWorkspaceMembersRead(workspace).members;
}

/**
 * Who a workspace's work names but who left it, read as its members are, and
 * again whenever its count changes or a retry asks, with whether the read was
 * refused; none while unread, refused, or for no workspace, and none from a
 * service that names nobody.
 */
export function useFormerMembersRead(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): FormerMembersRead {
  const { act } = useAct();
  const read = useCallback(
    (workspaceId: string) => act(ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, { workspaceId }),
    [act],
  );
  const { rows, refused, retry } = useCountedRead(workspace, read);
  return { former: rows, refused, retry };
}

/**
 * Who a workspace's work names but who left it, as `useFormerMembersRead`
 * reads them. Note that a read that failed leaves them unread, since someone
 * who left still stands grayed by their letter without their picture.
 */
export function useFormerMembers(
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined,
): readonly FormerMember[] | undefined {
  return useFormerMembersRead(workspace).former;
}
