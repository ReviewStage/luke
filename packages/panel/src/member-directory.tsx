import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { TaskSummary } from "@repo/features/task-wire";
import type { FormerMember, Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { type Actor, accountActor, creatorActor, personActor } from "@repo/ui/actor-model";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { workspaceMembersQuery, workspaceMembersRetryMutation } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

export interface Directory {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former: readonly FormerMember[] | undefined;
  readonly workspaceId?: string | undefined;
  readonly memberCount?: number | undefined;
  readonly reading: boolean;
  readonly refused: boolean;
  readonly retry: () => void;
}

const NOBODY_LEFT: readonly FormerMember[] = [];

const DirectoryContext = createContext<Directory>({
  members: undefined,
  readerId: undefined,
  former: undefined,
  reading: false,
  refused: false,
  retry: () => undefined,
});

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
  const former = rows === undefined ? undefined : (rows.former ?? NOBODY_LEFT);
  const reading = workspaceId !== undefined && rows === undefined && !read.isError;
  const refused = workspaceId !== undefined && read.isError;
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

export function useMemberDirectory(): Directory {
  return useContext(DirectoryContext);
}

export function usePerson(
  ref: { readonly userId: string; readonly name: string } | undefined,
): Actor {
  const { members, readerId, former } = useMemberDirectory();
  return personActor(ref, members, readerId, former);
}

export function useCreator(
  task: Pick<TaskSummary, "createdBy" | "ownerId">,
  readerId?: string | undefined,
): Actor {
  const directory = useMemberDirectory();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  return creatorActor(task, { ...directory, readerId: directory.readerId ?? readerId }, you);
}
