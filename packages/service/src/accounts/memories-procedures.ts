import { Effect } from "effect";
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
  WORKSPACE_MEMORY,
  type WorkspaceMemoryAnswer,
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
  };
}
