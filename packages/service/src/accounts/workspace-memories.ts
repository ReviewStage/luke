import {
  forgetMemory,
  listMemories,
  MEMORY_FORGET,
  MEMORY_OUTCOME,
  rememberMemory,
  type StoredMemory,
} from "@repo/database/models/memory-store";
import {
  readAccountNames,
  type WorkspaceStoreEffect,
  workspaceOf,
} from "@repo/database/models/workspace-store";
import type { MemorySaveAnswer, MemorySummary } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import { looksLikeCredential, rankMemories } from "../agents/memory-tools.js";

/**
 * workspace-memories.ts -- a workspace's shared memories as one member reads and forgets them from Settings.
 *
 * Every member of a workspace reads its shared memories, each named by the
 * member whose words it holds. Forgetting follows the workspace automations' rule
 * (`automation-store.ts`'s `allowedTo`): the member whose words a memory
 * holds may forget it, and so may the workspace's owners and admins, the
 * only ones who may forget one whose member's account is gone; every other
 * member reads it and may correct it only on a call, where the conversation
 * wins. An account that is not a member reads and forgets
 * nothing, and is answered exactly as a workspace that names nothing.
 *
 * A member's own client, such as the command-line tool, also keeps a memory
 * in the member's words and searches them, as the member MCP server's
 * `save_memory` and `search_memory` do: a keep goes through the same store
 * write (`rememberMemory`) after the same credential check
 * (`looksLikeCredential`), and a search ranks the memories as an agent's
 * recall does (`rankMemories`). Whether the member has Memory on is the
 * caller's to check, as each tool and procedure does before it calls here.
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
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      /** The transaction a forget deleted its memory in; none for a read, or a forget of one already gone. */
      readonly txid?: string;
    }
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
    stored.map((kept) => summaryOf(userId, manages, names, kept)),
  );
}

/** One memory as the reader sees it, its member's name read beside it. */
function summaryOf(
  userId: string,
  manages: boolean,
  names: ReadonlyMap<string, string>,
  kept: StoredMemory,
): MemorySummary {
  return {
    id: kept.id,
    text: kept.text,
    keptBy: keeperOf(kept.userId, names),
    forgettable: manages || kept.userId === userId,
    createdAt: kept.createdAt,
    updatedAt: kept.updatedAt,
  };
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
 * the memories as they then stand, with the transaction it was deleted in. A
 * memory already gone answers the same as one forgotten now, with no
 * transaction, so a forget retried after it landed answers the same.
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
    if (forgot.outcome === MEMORY_FORGET.NOT_PERMITTED)
      return { kind: WORKSPACE_MEMORY.NOT_PERMITTED } as const;
    const memories = yield* summariesFor(userId, manages, yield* listMemories(workspaceId));
    return {
      kind: WORKSPACE_MEMORY.READ,
      memories,
      ...(forgot.txid === undefined ? undefined : { txid: forgot.txid }),
    } as const;
  });
}

/** What a member's keep came to. */
export const WORKSPACE_MEMORY_SAVE = {
  /** The memory was kept, was already kept, or corrected the one it replaces. */
  SAVED: "saved",
  /** The account is no member of the workspace, or the workspace names nothing. */
  NOT_MEMBER: "not_member",
  /** The words look like they hold a credential; nothing was written. */
  CREDENTIAL: "credential",
  /** The memory it replaces is not the workspace's, or was forgotten; nothing was written. */
  NOT_FOUND: "not_found",
  /** The workspace holds as many memories as it may; nothing was written. */
  FULL: "full",
} as const;

export type WorkspaceMemorySaveAnswer =
  | ({ readonly kind: typeof WORKSPACE_MEMORY_SAVE.SAVED } & MemorySaveAnswer)
  | {
      readonly kind: Exclude<
        (typeof WORKSPACE_MEMORY_SAVE)[keyof typeof WORKSPACE_MEMORY_SAVE],
        typeof WORKSPACE_MEMORY_SAVE.SAVED
      >;
    };

export type WorkspaceMemorySearchAnswer =
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      readonly total: number;
    }
  | { readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER };

/**
 * Keeps a memory in the member's words, in a workspace they are a member
 * of, or corrects the one `replaces` names, and answers what that came to
 * with the memory as the member then sees it. Words that look like a
 * credential are refused before the store is reached.
 */
export function saveWorkspaceMemory(
  userId: string,
  workspaceId: string,
  text: string,
  replaces: string | undefined,
): WorkspaceStoreEffect<WorkspaceMemorySaveAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);
    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY_SAVE.NOT_MEMBER } as const;
    if (looksLikeCredential(text)) return { kind: WORKSPACE_MEMORY_SAVE.CREDENTIAL } as const;
    const outcome = yield* rememberMemory(workspaceId, userId, text, replaces);
    switch (outcome.kind) {
      case MEMORY_OUTCOME.NOT_FOUND:
        return { kind: WORKSPACE_MEMORY_SAVE.NOT_FOUND } as const;
      case MEMORY_OUTCOME.FULL:
        return { kind: WORKSPACE_MEMORY_SAVE.FULL } as const;
      default: {
        const kept = outcome.memory;
        const names = yield* readAccountNames(kept.userId === null ? [] : [kept.userId]);
        const memory = summaryOf(userId, MANAGING_ROLES.has(role.value), names, kept);
        return { kind: WORKSPACE_MEMORY_SAVE.SAVED, outcome: outcome.kind, memory } as const;
      }
    }
  });
}

/** The workspace's memories a search's words find, best first, as recall ranks them, and how many it holds, to a member of it. */
export function searchWorkspaceMemories(
  userId: string,
  workspaceId: string,
  query: string | undefined,
): WorkspaceStoreEffect<WorkspaceMemorySearchAnswer> {
  return Effect.gen(function* () {
    const role = yield* roleIn(userId, workspaceId);
    if (Option.isNone(role)) return { kind: WORKSPACE_MEMORY.NOT_MEMBER } as const;
    const stored = yield* listMemories(workspaceId);
    const found = rankMemories(stored, query);
    const memories = yield* summariesFor(userId, MANAGING_ROLES.has(role.value), found);
    return { kind: WORKSPACE_MEMORY.READ, memories, total: stored.length } as const;
  });
}
