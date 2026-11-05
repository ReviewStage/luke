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
 * A keep and a search here are the one operation behind every surface that
 * keeps or searches a memory: a member's own client, such as the
 * command-line tool, the member MCP server's `save_memory` and
 * `search_memory`, and a coding agent's (`../agents/memory-tools.ts`), each
 * answering the outcome in its own words. Words that look like a credential
 * are never kept, and a search ranks the memories by how many of its words
 * each holds (`rankMemories`). Whether the member has Memory on is the
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

const MEMORY_SEARCH_BOUNDS = {
  /** The most memories one search hands back. */
  RECALL_RESULTS: 8,
  /** The most distinct words of a query matched. */
  QUERY_WORDS: 16,
} as const;

/** Words too common to tell one memory from another. */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "use",
  "we",
  "what",
  "with",
]);

/**
 * Shapes a credential takes: a private key block, a provider's token by its
 * prefix, a signed token, a URL carrying a password, a secret assigned to a
 * name, and a long opaque run mixing cases and digits as generated keys do.
 * A commit hash or a UUID, all lower case, is none of them.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/u,
  /\bglpat-[A-Za-z0-9_-]{20,}/u,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{30,}/u,
  /\bnpm_[A-Za-z0-9]{30,}/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*\S{6,}/iu,
];

/** A run long and mixed enough to be a generated secret rather than a word. */
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/gu;

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

/** Whether words look like they hold a credential, so they are never kept. */
function looksLikeCredential(text: string): boolean {
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(text))) return true;
  return (text.match(OPAQUE_RUN) ?? []).some(
    (run) => /[a-z]/u.test(run) && /[A-Z]/u.test(run) && /[0-9]/u.test(run),
  );
}

/** A text's words as a search compares them: lower case, letters and digits alone. */
function wordsOf(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The memories a query finds, best first: each scored by how many of the
 * query's distinct words begin one of its own, so "deploy" finds
 * "deployment", ties going to the one kept most recently. A query with no
 * telling word answers the most recent; one that finds nothing answers none.
 */
function rankMemories(
  memories: readonly StoredMemory[],
  query: string | undefined,
): readonly StoredMemory[] {
  const asked = [...new Set(wordsOf(query ?? ""))]
    .filter((word) => !COMMON_WORDS.has(word))
    .slice(0, MEMORY_SEARCH_BOUNDS.QUERY_WORDS);
  if (asked.length === 0) return memories.slice(0, MEMORY_SEARCH_BOUNDS.RECALL_RESULTS);
  return memories
    .map((memory, recency) => {
      const own = wordsOf(memory.text);
      const score = asked.filter((word) => own.some((held) => held.startsWith(word))).length;
      return { memory, score, recency };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.recency - b.recency)
    .slice(0, MEMORY_SEARCH_BOUNDS.RECALL_RESULTS)
    .map((scored) => scored.memory);
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
