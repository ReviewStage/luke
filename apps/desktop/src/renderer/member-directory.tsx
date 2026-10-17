import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { TaskSummary } from "@luke/features/task-wire";
import type { FormerMember, Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { type Actor, accountActor, creatorActor, personActor } from "@luke/ui/actor-model";
import { createContext, type ReactNode, useContext } from "react";
import { useFormerMembers, useWorkspaceMembers } from "./tasks/use-workspace-members";
import { useAppState } from "./use-app-state";

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
 */

/** The members as read, the reader's own account id, who the workspace's work names but left, and the workspace they are the members of. */
interface Directory {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former: readonly FormerMember[] | undefined;
  /** The workspace whose members these are, which a person named here is opened in. */
  readonly workspaceId?: string | undefined;
}

const DirectoryContext = createContext<Directory>({
  members: undefined,
  readerId: undefined,
  former: undefined,
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
  const members = useWorkspaceMembers(workspace);
  const former = useFormerMembers(workspace);
  return (
    <DirectoryContext.Provider value={{ members, readerId, former, workspaceId: workspace?.id }}>
      {children}
    </DirectoryContext.Provider>
  );
}

/** The directory standing around the caller: the members as read, and the reader's id. */
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
  plan: Pick<TaskSummary, "createdBy" | "ownerId">,
  readerId?: string | undefined,
): Actor {
  const directory = useMemberDirectory();
  const account = useAppState()?.account;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  return creatorActor(plan, { ...directory, readerId: directory.readerId ?? readerId }, you);
}
