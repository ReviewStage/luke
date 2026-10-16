import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";

/**
 * memory-wire.ts -- a workspace's memories, the settled facts Luke kept from its planning calls, as Settings reads and forgets them.
 *
 * Luke's planning model keeps a memory when a call settles a fact or a
 * convention worth carrying into the workspace's later plans, and corrects
 * one in place when a call contradicts it; nothing asks first. The memory is
 * the workspace's, shared by every member, and no plan in another workspace
 * recalls it. Settings is where a member reads what Luke kept and forgets
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
 */

export const MEMORY_BOUNDS = {
  /** The longest memory kept: a fact or a convention in a sentence or three, never a document. */
  MAX_CHARS: 400,
  /** The most memories one workspace keeps; past it a new one is refused until one is corrected or forgotten. */
  MAX_MEMORIES: 200,
} as const;

/** The query every request names its workspace in, and `DELETE` its memory. */
export const MEMORY_QUERY = {
  WORKSPACE_ID: "workspaceId",
  ID: "id",
} as const;

/** A memory's id as the service mints it: the row's UUID. */
export const memoryIdSchema = wireUuidSchema;

/** One memory as a member of its workspace sees it. */
export const memorySummarySchema = EffectSchema.Struct({
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

/** The workspace's memories (GET, and every DELETE's answer), most recently updated first. */
export const memoriesAnswerSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memorySummarySchema),
});

export type MemoriesAnswer = typeof memoriesAnswerSchema.Type;
