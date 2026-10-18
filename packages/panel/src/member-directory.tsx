import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { TaskSummary } from "@luke/features/task-wire";
import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { type Actor, accountActor, creatorActor, personActor } from "@luke/ui/actor-model";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import { useFormerMembersRead, useWorkspaceMembersRead } from "./tasks/use-workspace-members.js";
import { useAppState } from "./use-app-state.js";

/**
 * member-directory.tsx -- the members of the workspace the open task lives in, read once for everything in the task that names a person.
 *
 * The wire names a person by `{userId, name}` alone, so a byline, the Call
 * tab, an agent's card, and an Inbox answer each read the person against the
 * workspace's members for their picture, email, and role, and the reader's
 * own id to say You (`@luke/ui/actor-model`'s `personActor`), and someone
 * who left keeps their picture, grayed, from who the read says left. The plan reads
 * the members once, here, rather than once for every line naming someone,
 * and again whenever the workspace's count changes. Outside a directory, or
 * while the members are unread, a person stands by the wire's name alone.
 * The directory also says whether its reads are out or were refused, with
 * their Retry, so a place that cannot draw without them, a person's page,
 * says why rather than wait on a read that will not answer.
 */

/** The members as read, the reader's own account id, who the workspace's work names but left, the workspace they are the members of, and where their reads stand. */
interface Directory {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former: readonly FormerMember[] | undefined;
  /** The workspace whose members these are, which a person named here is opened in. */
  readonly workspaceId?: string | undefined;
  /** Whether the members or who left are still being read, neither read refused. */
  readonly reading: boolean;
  /** Whether the members read or the read of who left was refused, until Retry asks again. */
  readonly refused: boolean;
  /** Reads again whichever of the members and who left was refused. */
  readonly retry: () => void;
}

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
  const {
    members,
    refused: membersRefused,
    retry: retryMembers,
  } = useWorkspaceMembersRead(workspace);
  const { former, refused: formerRefused, retry: retryFormer } = useFormerMembersRead(workspace);
  const refused = membersRefused || formerRefused;
  const reading =
    workspace !== undefined && !refused && (members === undefined || former === undefined);
  // Note that Retry asks again only for a read that was refused, so the one that answered stays drawn meanwhile.
  const retry = useCallback(() => {
    if (membersRefused) retryMembers();
    if (formerRefused) retryFormer();
  }, [membersRefused, formerRefused, retryMembers, retryFormer]);
  return (
    <DirectoryContext.Provider
      value={{ members, readerId, former, workspaceId: workspace?.id, reading, refused, retry }}
    >
      {children}
    </DirectoryContext.Provider>
  );
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
  const account = useAppState()?.account;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  return creatorActor(task, { ...directory, readerId: directory.readerId ?? readerId }, you);
}
