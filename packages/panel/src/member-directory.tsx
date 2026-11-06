import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { TaskSummary } from "@repo/features/task-wire";
import type { FormerMember, Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { type Actor, accountActor, creatorActor, personActor } from "@repo/ui/actor-model";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { workspaceMembersQuery, workspaceMembersRetryMutation } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

/**
 * member-directory.tsx -- the members of the workspace the open task lives in, read once for everything in the task that names a person.
 *
 * The wire names a person by `{userId, name}` alone, so a byline, the Call
 * tab, an agent's card, and an Inbox answer each read the person against the
 * workspace's members for their picture, email, and role, and the reader's
 * own id to say You (`@repo/ui/actor-model`'s `personActor`), and someone
 * who left keeps their picture, grayed, from who the read says left. The
 * directory holds the workspace's people once, here, rather than once for
 * every line naming someone, on the one read the host holds of them
 * (`LIVE_READ.WORKSPACE_MEMBERS`), so a surface drawn again draws its faces
 * in its first frame. Outside a directory, or while the people are unread,
 * a person stands by the wire's name alone. The directory also says whether
 * the read is out or was refused, with its Retry, so a place that cannot
 * draw without it, a person's page, says why rather than wait on a read that
 * will not answer.
 */

/** The members as read, the reader's own account id, who the workspace's work names but left, the workspace they are the members of, and where their read stands. */
export interface Directory {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former: readonly FormerMember[] | undefined;
  /** The workspace whose members these are, which a person named here is opened in. */
  readonly workspaceId?: string | undefined;
  /** How many members that workspace has, as its listing counts them, before the members are read. */
  readonly memberCount?: number | undefined;
  /** Whether the workspace's people are still being read, the read not refused. */
  readonly reading: boolean;
  /** Whether the read of the workspace's people was refused before it ever answered, until Retry asks again. */
  readonly refused: boolean;
  /** Reads the workspace's people again. */
  readonly retry: () => void;
}

/** Who left a workspace whose read names nobody, one list for every draw, so the directory holds while nothing moves. */
const NOBODY_LEFT: readonly FormerMember[] = [];

const DirectoryContext = createContext<Directory>({
  members: undefined,
  readerId: undefined,
  former: undefined,
  reading: false,
  refused: false,
  retry: () => undefined,
});

/** Reads the workspace's members for everything inside it; none for no workspace. */
export function MemberDirectory({
  workspace,
  readerId,
  children,
}: {
  workspace: Pick<Workspace, "id" | "memberCount"> | undefined;
  readerId: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const workspaceId = workspace?.id;
  const read = useQuery(workspaceMembersQuery(workspaceId));
  const { mutate } = useMutation(workspaceMembersRetryMutation());
  const retry = useCallback(() => {
    if (workspaceId !== undefined) mutate({ workspaceId });
  }, [mutate, workspaceId]);
  const rows = read.data;
  const members = rows?.members;
  // Note that who left stands unread as long as the members do, and as nobody once a read names nobody.
  const former = rows === undefined ? undefined : (rows.former ?? NOBODY_LEFT);
  const reading = workspaceId !== undefined && rows === undefined && !read.isError;
  const refused = workspaceId !== undefined && read.isError;
  // Note that the directory is the same across draws while none of it moves, because every
  // face and name inside it is drawn again for a new one.
  const memberCount = workspace?.memberCount;
  const directory = useMemo(
    () => ({
      members,
      readerId,
      former,
      workspaceId,
      memberCount,
      reading,
      refused,
      retry,
    }),
    [members, readerId, former, workspaceId, memberCount, reading, refused, retry],
  );
  return <DirectoryContext.Provider value={directory}>{children}</DirectoryContext.Provider>;
}

/** The directory standing around the caller: the members as read, the reader's id, and where the reads stand. */
export function useMemberDirectory(): Directory {
  return useContext(DirectoryContext);
}

/** A member the wire names, as the directory around the caller draws them (`personActor`). */
export function usePerson(
  ref: { readonly userId: string; readonly name: string } | undefined,
): Actor {
  const { members, readerId, former } = useMemberDirectory();
  return personActor(ref, members, readerId, former);
}

/**
 * Who created a task, as the directory around the caller draws them
 * (`creatorActor`). Note that a task the list names by its owner's id alone
 * is the reader's own wherever that id is theirs, drawn as their account
 * signs in, so a members read that failed never names their own task as
 * someone's; `readerId` stands for the reader outside a directory.
 */
export function useCreator(
  task: Pick<TaskSummary, "createdBy" | "ownerId">,
  readerId?: string | undefined,
): Actor {
  const directory = useMemberDirectory();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  return creatorActor(task, { ...directory, readerId: directory.readerId ?? readerId }, you);
}
