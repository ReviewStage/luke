import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";
import { trimmedText } from "./text-schema.js";

/**
 * memory-wire.ts -- a workspace's memories, the settled facts its coding agents kept, as Settings reads and forgets them and a member's own client keeps and searches them.
 *
 * A coding agent keeps a memory when its work settles a fact or a convention
 * worth carrying into the workspace's later work, and corrects one in place
 * when its developer contradicts it; nothing asks first. The memory is
 * the workspace's, shared by every member, and no agent in another workspace
 * recalls it. Settings is where a member reads what the agents kept and forgets
 * what is wrong. `/api/account/memories?workspaceId=` answers the
 * workspace's memories to a member of it, most recently kept or corrected
 * first (GET), and forgets one by its id named in the query (DELETE), which
 * removes it for good: no later call recalls it. A memory may be forgotten
 * by the member whose words it holds and by the workspace's owners and
 * admins, which each memory's `forgettable` says for the reader; a memory
 * outlives the account whose words it holds, named by nobody once it is gone; a forget of
 * one the reader may not forget is refused. Every answer carries the
 * workspace's memories as they then stand, so the page draws the service's
 * word rather than its own guess, and forgetting one already gone answers
 * the list as it stands.
 *
 * A member's own client, such as the command-line tool, also keeps a memory
 * in their own words (POST, `memorySaveRequestSchema`) and searches the
 * workspace's memories by a few words (`ACCOUNT_MEMORIES_SEARCH`), as the
 * member MCP server's `save_memory` and `search_memory` do, and only while
 * the member has Memory on, as those tools are. A memory that looks like it
 * holds a credential is refused before the store is reached, as an agent's
 * is.
 */

export const MEMORY_BOUNDS = {
  /** The longest memory kept: a fact or a convention in a sentence or three, never a document. */
  MAX_CHARS: 400,
  /** The most memories one workspace keeps; past it a new one is refused until one is corrected or forgotten. */
  MAX_MEMORIES: 1_000,
  /** The longest search read; a search is a few words, never a passage. */
  MAX_QUERY_CHARS: 300,
} as const;

/** The query every request names its workspace in, and `DELETE` its memory. */
export const MEMORY_QUERY = {
  WORKSPACE_ID: "workspaceId",
  ID: "id",
  /** A search's words. */
  QUERY: "query",
} as const;

/** A memory's id as the service mints it: the row's UUID. */
export const memoryIdSchema = wireUuidSchema;

/** One memory as a member of its workspace sees it. */
const memorySummarySchema = EffectSchema.Struct({
  id: memoryIdSchema,
  text: EffectSchema.String,
  /** The member whose words it holds: who kept it, or last corrected it; null once that account is gone. */
  keptBy: EffectSchema.NullOr(memberRefSchema),
  /** Whether the reader may forget it: its words are theirs, or they own or administer the workspace. */
  forgettable: EffectSchema.Boolean,
  /** When it was kept, in epoch milliseconds. */
  createdAt: countedNumber,
  /** When it was last kept or corrected, in epoch milliseconds. */
  updatedAt: countedNumber,
});

export type MemorySummary = typeof memorySummarySchema.Type;

/**
 * The workspace's memories (GET, and every DELETE's answer), most recently
 * updated first; a DELETE that deleted the memory carries the transaction it
 * was deleted in, which a reader following the memories waits for, and one
 * of a memory already gone carries none.
 */
export const memoriesAnswerSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memorySummarySchema),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type MemoriesAnswer = typeof memoriesAnswerSchema.Type;

/** What a keep came to: a new memory, the same words already kept, or the memory it replaces corrected. */
export const MEMORY_SAVED = {
  KEPT: "kept",
  ALREADY_KEPT: "already_kept",
  CORRECTED: "corrected",
} as const;

/**
 * A memory kept in the member's own words (POST): the workspace, the
 * statement, and, at most, the memory it corrects, which is then rewritten
 * in place rather than kept beside it.
 */
export const memorySaveRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  text: trimmedText(MEMORY_BOUNDS.MAX_CHARS),
  replaces: EffectSchema.optionalKey(memoryIdSchema),
});

export type MemorySaveRequest = typeof memorySaveRequestSchema.Type;

/** What a keep came to, and the memory as it then stands. */
export const memorySaveAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(MEMORY_SAVED)),
  memory: memorySummarySchema,
});

export type MemorySaveAnswer = typeof memorySaveAnswerSchema.Type;

/** A search's words, at most; none answers the memories kept most recently. */
export const memorySearchQuerySchema = EffectSchema.optionalKey(
  EffectSchema.Trim.check(EffectSchema.isMaxLength(MEMORY_BOUNDS.MAX_QUERY_CHARS)),
);

/** The memories a search found, best first, and how many the workspace holds. */
export const memorySearchAnswerSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memorySummarySchema),
  total: countedNumber,
});

export type MemorySearchAnswer = typeof memorySearchAnswerSchema.Type;
