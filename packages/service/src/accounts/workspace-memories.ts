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

export const WORKSPACE_MEMORY = {
  READ: "read",
  NOT_MEMBER: "not_member",
  NOT_PERMITTED: "not_permitted",
} as const;

export type WorkspaceMemoryAnswer =
  | {
      readonly kind: typeof WORKSPACE_MEMORY.READ;
      readonly memories: readonly MemorySummary[];
      readonly txid?: string;
    }
  | {
      readonly kind: typeof WORKSPACE_MEMORY.NOT_MEMBER | typeof WORKSPACE_MEMORY.NOT_PERMITTED;
    };

const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

const MEMORY_SEARCH_BOUNDS = {
  RECALL_RESULTS: 8,
  QUERY_WORDS: 16,
} as const;

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

const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/gu;

function roleIn(
  userId: string,
  workspaceId: string,
): WorkspaceStoreEffect<Option.Option<WorkspaceRole>> {
  return Effect.map(
    workspaceOf(userId, workspaceId),
    Option.map((workspace) => workspace.role),
  );
}

function keeperOf(
  userId: string | null,
  names: ReadonlyMap<string, string>,
): MemorySummary["keptBy"] {
  if (userId === null) return null;
  const name = names.get(userId);
  return name === undefined ? null : { userId, name };
}

function looksLikeCredential(text: string): boolean {
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(text))) return true;
  return (text.match(OPAQUE_RUN) ?? []).some(
    (run) => /[a-z]/u.test(run) && /[A-Z]/u.test(run) && /[0-9]/u.test(run),
  );
}

function wordsOf(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

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

export const WORKSPACE_MEMORY_SAVE = {
  SAVED: "saved",
  NOT_MEMBER: "not_member",
  CREDENTIAL: "credential",
  NOT_FOUND: "not_found",
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
