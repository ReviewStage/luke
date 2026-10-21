import type { TasksWorkspaceMembersAnswer } from "@luke/features/tasks-view";
import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { streamFrom } from "../act-stream.js";
import { actPort } from "../app-bridge.js";

/**
 * use-workspace-members.ts -- a workspace's members, and who left it, as a place that draws them holds them: the task's member directory, the command palette, and a plan's version history.
 *
 * The members, and who left, are read once as the place opens and followed
 * while it stands: the host streams them each time they move (over Neon
 * Realtime), so someone joining, leaving, or given another role elsewhere
 * shows without another read. Until they answer, or if they never do, the
 * place has none, and draws what it can without them: a count alone, or a
 * teammate's letter where their picture would stand. Each place follows for
 * itself; the host follows each workspace once however many places do.
 */

/** A workspace's members as a place that says why it has none holds them: the members, whether the last read was refused, and a way to read them again. */
export interface WorkspaceMembersRead {
  /** The members, none while unread, refused, or for no workspace. */
  readonly members: readonly WorkspaceMember[] | undefined;
  /** Whether the workspace's people were refused, until another read is asked for. */
  readonly refused: boolean;
  /** Reads the members again, standing unread until the read answers. */
  readonly retry: () => void;
}

/** Who left a workspace as a place that says why it has none holds them, as `WorkspaceMembersRead` holds the members. */
export interface FormerMembersRead {
  /** Who left, none while unread, refused, or for no workspace. */
  readonly former: readonly FormerMember[] | undefined;
  /** Whether the workspace's people were refused, until another read is asked for. */
  readonly refused: boolean;
  /** Reads who left again, standing unread until the read answers. */
  readonly retry: () => void;
}

/** A list as one place holds it, under the workspace and the retry it answers. */
interface HeldList<Row> {
  readonly workspaceId: string;
  /** Which retry it answers, so a refusal stands only until the next is asked for. */
  readonly asked: number;
  readonly rows: readonly Row[];
  readonly refused: boolean;
}

/** A list of a workspace's people as one place holds it: the rows, none until they answer; whether they were refused; and Retry. */
interface FollowedList<Row> {
  readonly rows: readonly Row[] | undefined;
  readonly refused: boolean;
  readonly retry: () => void;
}

/**
 * One list of the workspace's people, read once with `read`, which must be
 * stable, and then followed for as long as the place stands: the host
 * streams the workspace's people, and each word is picked by `pick` and
 * taken over whatever the read answered, since it is the newer word. Retry
 * reads and follows again.
 */
function useFollowedList<Row>(
  workspaceId: string | undefined,
  read: (workspaceId: string) => Promise<readonly Row[]>,
  pick: (view: TasksWorkspaceMembersAnswer) => readonly Row[] | undefined,
): FollowedList<Row> {
  const [held, setHeld] = useState<HeldList<Row>>();
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (workspaceId === undefined) return;
    let live = true;
    let pushed = false;
    const keep = (rows: readonly Row[], refused: boolean) => {
      if (live) setHeld({ workspaceId, asked, rows, refused });
    };
    const stop = streamFrom(
      () => actPort()[ACT_KIND.WORKSPACE_PEOPLE]({ workspaceId }),
      (view) => {
        pushed = true;
        const rows = pick(view);
        keep(rows ?? [], rows === undefined);
      },
    );
    read(workspaceId).then(
      (rows) => {
        if (!pushed) keep(rows, false);
      },
      () => {
        if (!pushed) keep([], true);
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, [read, pick, workspaceId, asked]);
  const retry = useCallback(() => setAsked((count) => count + 1), []);
  // Note that a list held of another workspace, or before a retry, is not handed on.
  const current = held !== undefined && held.workspaceId === workspaceId && held.asked === asked;
  return {
    rows: current && !held.refused ? held.rows : undefined,
    refused: current && held.refused,
    retry,
  };
}

/** The members a word carries; none where it says why there are none. */
function pushedMembers(view: TasksWorkspaceMembersAnswer): readonly WorkspaceMember[] | undefined {
  return "members" in view ? view.members : undefined;
}

/** Who left as a word carries them, none named where nobody did; none where it says why there are none. */
function pushedFormer(view: TasksWorkspaceMembersAnswer): readonly FormerMember[] | undefined {
  return "members" in view ? (view.former ?? []) : undefined;
}

/** A workspace's members, read once and followed while the place stands, with whether they were refused. */
export function useWorkspaceMembersRead(
  workspace: Pick<Workspace, "id"> | undefined,
): WorkspaceMembersRead {
  const { act } = useAct();
  const read = useCallback(
    (workspaceId: string) => act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }),
    [act],
  );
  const { rows, refused, retry } = useFollowedList(workspace?.id, read, pushedMembers);
  return { members: rows, refused, retry };
}

/** A workspace's members, read once and followed while the place stands; none while unread, refused, or for no workspace. */
export function useWorkspaceMembers(
  workspace: Pick<Workspace, "id"> | undefined,
): readonly WorkspaceMember[] | undefined {
  // Note that a refused read leaves the place as it stands, because it draws what it can without the members.
  return useWorkspaceMembersRead(workspace).members;
}

/**
 * Who a workspace's work names but who left it, read and followed as its
 * members are, with whether they were refused; none while unread, refused,
 * or for no workspace, and none from a service that names nobody.
 */
export function useFormerMembersRead(
  workspace: Pick<Workspace, "id"> | undefined,
): FormerMembersRead {
  const { act } = useAct();
  const read = useCallback(
    (workspaceId: string) => act(ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, { workspaceId }),
    [act],
  );
  const { rows, refused, retry } = useFollowedList(workspace?.id, read, pushedFormer);
  return { former: rows, refused, retry };
}

/**
 * Who a workspace's work names but who left it, as `useFormerMembersRead`
 * reads them. Note that a read that failed leaves them unread, since someone
 * who left still stands grayed by their letter without their picture.
 */
export function useFormerMembers(
  workspace: Pick<Workspace, "id"> | undefined,
): readonly FormerMember[] | undefined {
  return useFormerMembersRead(workspace).former;
}
