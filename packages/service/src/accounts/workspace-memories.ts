import {
  forgetMemory,
  listMemories,
  MEMORY_FORGET,
  type StoredMemory,
} from "@luke/database/models/memory-store";
import {
  readAccountNames,
  type WorkspaceStoreEffect,
  workspaceOf,
} from "@luke/database/models/workspace-store";
import type { MemorySummary } from "@luke/features/memory-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { Effect, Option } from "effect";

/**
 * workspace-memories.ts -- a workspace's shared memories as one member reads and forgets them from Settings.
 *
 * Every member of a workspace reads its memories, each named by the member
 * whose words it holds. Forgetting follows the workspace automations' rule
 * (`automation-store.ts`'s `allowedTo`): the member whose words a memory
 * holds may forget it, and so may the workspace's owners and admins, the
 * only ones who may forget one whose member's account is gone; every other
 * member reads it and may correct it only on a call, where the conversation
 * wins. An account that is not a member reads and forgets
 * nothing, and is answered exactly as a workspace that names nothing.
 */

/** What a member's read or forget came to. */
export const WORKSPACE_MEMORY = {
  /** The workspace's memories as they stand now. */
  READ: "read",
  /** The account is no member of the workspace, or the workspace names nothing. */
  NOT_MEMBER: "not_member",
  /** The memory stands and the member may not forget it; nothing was deleted. */
  NOT_PERMITTED: "not_permitted",
} as const;

export type WorkspaceMemoryAnswer =
  | { readonly kind: typeof WORKSPACE_MEMORY.READ; readonly memories: readonly MemorySummary[] }
  | {
      readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER | typeof WORKSPACE_MEMORY.NOT_PERMITTED;
    };

/** The roles that manage a workspace's memories beyond their own. */
const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

/** The member's role in the workspace, where they are one. */
function roleIn(
  userId: string,
  workspaceId: string,
): WorkspaceStoreEffect<Option.Option<WorkspaceRole>> {
  return Effect.map(
    workspaceOf(userId, workspaceId),
    Option.map((workspace) => workspace.role),
  );
}

/** The member whose words a memory holds, as the reader is told; nobody for an account that is gone. */
function keeperOf(
  userId: string | null,
  names: ReadonlyMap<string, string>,
): MemorySummary["keptBy"] {
  if (userId === null) return null;
  const name = names.get(userId);
  return name === undefined ? null : { userId, name };
}

/** The workspace's memories as the reader sees them: each named by its member, and forgettable where the reader may. */
function summariesFor(
  userId: string,
  manages: boolean,
  stored: readonly StoredMemory[],
): WorkspaceStoreEffect<readonly MemorySummary[]> {
  const members = stored.flatMap((kept) => (kept.userId === null ? [] : [kept.userId]));
  return Effect.map(readAccountNames(members), (names) =>
    stored.map((kept) => ({
      id: kept.id,
      text: kept.text,
      keptBy: keeperOf(kept.userId, names),
      forgettable: manages || kept.userId === userId,
      createdAt: kept.createdAt,
      updatedAt: kept.updatedAt,
    })),
  );
}

/** The workspace's memories, to a member of it. */
export function readWorkspaceMemories(
  userId: string,
  workspaceId: string,
): WorkspaceStoreEffect<WorkspaceMemoryAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);
    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const stored = yield* listMemories(workspaceId);
    const memories = yield* summariesFor(userId, MANAGING_ROLES.has(role.value), stored);
    return { kind: WORKSPACE_MEMORY.READ, memories } as const;
  });
}

/**
 * Forgets one of the workspace's memories, where the member may, and answers
 * the memories as they then stand. A memory already gone answers the same as
 * one forgotten now, so a forget retried after it landed answers the same.
 */
export function forgetWorkspaceMemory(
  userId: string,
  workspaceId: string,
  id: string,
): WorkspaceStoreEffect<WorkspaceMemoryAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);
    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const manages = MANAGING_ROLES.has(role.value);
    const forgot = yield* forgetMemory(workspaceId, id, { userId, manages });
    if (forgot === MEMORY_FORGET.NOT_PERMITTED)
      return { kind: WORKSPACE_MEMORY.NOT_PERMITTED } as const;
    const memories = yield* summariesFor(userId, manages, yield* listMemories(workspaceId));
    return { kind: WORKSPACE_MEMORY.READ, memories } as const;
  });
}
