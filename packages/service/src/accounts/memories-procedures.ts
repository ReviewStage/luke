import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import { experimentOnIn } from "../agents/workspace-experiment-on.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  forgetWorkspaceMemory,
  readWorkspaceMemories,
  saveWorkspaceMemory,
  searchWorkspaceMemories,
  WORKSPACE_MEMORY,
  WORKSPACE_MEMORY_SAVE,
  type WorkspaceMemoryAnswer,
  type WorkspaceMemorySaveAnswer,
} from "./workspace-memories.js";

/**
 * memories-procedures.ts -- a workspace's shared memories as Settings › Memory reads them and forgets one, for a signed-in member of it.
 *
 * The memories are what the workspace's coding agents kept
 * (`../agents/memory-tools.ts`); these procedures only read them and forget
 * one, for the workspace the query names. Who may forget which is
 * `workspace-memories.ts`'s: the member whose words a memory holds, and the
 * workspace's owners and admins. An account that is no member is answered
 * not found, exactly as a workspace that names nothing, and a forget the
 * member may not make, not permitted. A forget answers the memories as they
 * then stand, whether or not the id named one, so a forget retried after it
 * landed answers the same; one that deleted the memory answers the
 * transaction it was deleted in beside them, which a desktop holding the
 * workspace's memories live waits for (`workspaceMemoriesLive`).
 *
 * A member's own client keeps a memory in their words and searches them
 * (`saveMemory`, `searchMemories`), the member MCP server's `save_memory`
 * and `search_memory`, and as those tools are, only while the workspace
 * named has Memory on (`experimentOnIn`), refused as off otherwise. A keep
 * that looks like it holds a credential is refused, as is one past the
 * workspace's bound, and a correction of a memory gone is answered not found.
 */

/** What the memories' procedures reach beyond the store: who the bearer is. */
export interface MemoriesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** A member's read or forget as the procedure answers it: the memories, or the refusal it came to. */
function memoriesAnswer(answer: WorkspaceMemoryAnswer) {
  switch (answer.kind) {
    case WORKSPACE_MEMORY.NOT_MEMBER:
      return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    case WORKSPACE_MEMORY.NOT_PERMITTED:
      return Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    case WORKSPACE_MEMORY.READ:
      return Effect.succeed({
        memories: answer.memories,
        ...(answer.txid === undefined ? undefined : { txid: answer.txid }),
      });
  }
}

/** A member's keep as the procedure answers it: what it came to and the memory, or the refusal. */
function saveAnswer(answer: WorkspaceMemorySaveAnswer) {
  switch (answer.kind) {
    case WORKSPACE_MEMORY_SAVE.NOT_MEMBER:
    case WORKSPACE_MEMORY_SAVE.NOT_FOUND:
      return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    case WORKSPACE_MEMORY_SAVE.CREDENTIAL:
      return Effect.fail(HOSTED_REFUSAL.MEMORY_CREDENTIAL);
    case WORKSPACE_MEMORY_SAVE.FULL:
      return Effect.fail(HOSTED_REFUSAL.MEMORY_FULL);
    case WORKSPACE_MEMORY_SAVE.SAVED:
      return Effect.succeed({ outcome: answer.outcome, memory: answer.memory });
  }
}

/** Refused as off unless the workspace has Memory on, as the member MCP server's memory tools are. */
const memoryOn = (workspaceId: string) =>
  Effect.flatMap(experimentOnIn(workspaceId, EXPERIMENT.MEMORY), (on) =>
    on ? Effect.void : Effect.fail(HOSTED_REFUSAL.MEMORY_OFF),
  );

/** The memories' procedures, each to a signed-in caller. */
export function memoriesProcedures(seams: MemoriesProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  return {
    memories: signedIn.memories.effect(function* ({ context, input }) {
      return yield* memoriesAnswer(
        yield* hostedStoreOrUnavailable(readWorkspaceMemories(context.userId, input.workspaceId)),
      );
    }),

    forgetMemory: signedIn.forgetMemory.effect(function* ({ context, input }) {
      const { workspaceId, id } = input.query;
      const answer = yield* hostedStoreOrUnavailable(
        forgetWorkspaceMemory(context.userId, workspaceId, id),
      );
      const answered = yield* memoriesAnswer(answer);
      // Note that a forget retried after it landed answers the same, so it is counted again; the store cannot tell the two apart.
      yield* recordServerEvent(
        SERVER_EVENT.MEMORY_FORGET,
        { userId: context.userId, workspaceId },
        {},
      );
      return answered;
    }),

    saveMemory: signedIn.saveMemory.effect(function* ({ context, input }) {
      const { workspaceId, text, replaces } = input;
      yield* memoryOn(workspaceId);
      return yield* saveAnswer(
        yield* hostedStoreOrUnavailable(
          saveWorkspaceMemory(context.userId, workspaceId, text, replaces),
        ),
      );
    }),

    searchMemories: signedIn.searchMemories.effect(function* ({ context, input }) {
      yield* memoryOn(input.workspaceId);
      const answer = yield* hostedStoreOrUnavailable(
        searchWorkspaceMemories(context.userId, input.workspaceId, input.query),
      );
      if (answer.kind === WORKSPACE_MEMORY.NOT_MEMBER) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      return { memories: answer.memories, total: answer.total };
    }),
  };
}
