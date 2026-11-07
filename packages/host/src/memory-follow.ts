import {
  AGENT_CALL_FAILURE,
  type MemoriesAnswerView,
  type MemoryForgetParams,
} from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type MemoryLiveRow,
  memoriesOfLiveRows,
  WORKSPACE_MEMORIES_READ,
  type WorkspaceMemoriesLiveAnswer,
} from "@repo/features/memory-live";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppMemories, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * memory-follow.ts -- each workspace's memories the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and a forget drawn gone over them the moment it is asked.
 *
 * Settings › Memory holds its workspace's memories, and the host follows
 * them while any window holds them and a while after (`heldSlice`), so a
 * memory an agent keeps, corrects, or another member forgets draws on every
 * open page within the service's coalesce window. Each memory is one row of
 * the pool (`@repo/sync`), by its id, and the page draws them as the held
 * read answers them (`@repo/features/memory-live`), followed as every pool
 * read is (`followLiveRead`). A forget is a write the pool draws over its
 * memory at once (`memoryForget`), standing until the read carries its
 * transaction, so no answer from before it puts the memory back, and taken
 * back where the service refused it. One of a memory already gone commits
 * nothing and answers no transaction, so it settles on its own answer. A
 * read of a workspace the account is no member of is told unanswered and
 * ends.
 */

/** A memory as the pool holds it, by its id, every write to it a change of its fields or its deletion. */
const MEMORY = fieldKind((row: MemoryLiveRow) => row.id);

/** A read the service did not answer, as the client and the gate tell it. */
interface MemoriesUnanswered {
  readonly failure: string;
}

export interface MemoriesFollowDependencies {
  /** One workspace's memories sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceMemoriesLiveAnswer | MemoriesUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which each held workspace's memories stand in while it is followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppMemories) => void;
}

/**
 * The held lifetime over every workspace's memories the windows hold
 * (`heldSlice`), keyed by the workspace, told whole on their slice: each
 * workspace's read as its follow last told it, kept where a later read does
 * not answer, and failed where it never answered.
 */
export function heldMemories(
  dependencies: MemoriesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.MEMORIES, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate: dependencies.gate,
    follow: (workspaceId, answers) => {
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.accountId();
      return followLiveRead(
        {
          seal: (poll, after) =>
            userId === undefined
              ? Effect.succeed(LIVE_SIGNED_OUT)
              : dependencies.seal(workspaceId, userId, poll, after),
          rows: WORKSPACE_MEMORIES_READ.rows,
          part: "memories",
          pool: dependencies.pool,
          kind: MEMORY,
          // Note that a workspace the account is no member of is followed no longer.
          endsFollow: (failure) => failure === AGENT_CALL_FAILURE.NOT_FOUND,
          draw: memoriesOfLiveRows,
        },
        answers,
      );
    },
    tell: dependencies.tell,
  });
}

/**
 * A memory forgotten, gone at once from every held read of its workspace,
 * sent as `send` asks. Note that a forget the service took answers the
 * memories as they then stand, and waits on the transaction it deleted in,
 * where it deleted one; a refusal puts the memory back.
 */
export function memoryForget(
  send: (forget: MemoryForgetParams) => Effect.Effect<MemoriesAnswerView>,
): WriteDeclaration<
  MemoryLiveRow,
  FieldChange<MemoryLiveRow>,
  MemoryForgetParams,
  MemoriesAnswerView
> {
  return {
    kind: MEMORY,
    keys: (forget) => [forget.id],
    change: () => () => ROW_GONE,
    send: (forget) =>
      Effect.map(send(forget), (answer) =>
        "memories" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };
}
