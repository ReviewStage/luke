import { Effect } from "effect";
import { memoryOnFor } from "../agents/memory-tools.js";
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

export interface MemoriesProcedureSeams {
  resolveUserId: UserIdResolver;
}

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

const memoryOn = (userId: string) =>
  Effect.flatMap(memoryOnFor(userId), (on) =>
    on ? Effect.void : Effect.fail(HOSTED_REFUSAL.MEMORY_OFF),
  );

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
      yield* recordServerEvent(
        SERVER_EVENT.MEMORY_FORGET,
        { userId: context.userId, workspaceId },
        {},
      );
      return answered;
    }),

    saveMemory: signedIn.saveMemory.effect(function* ({ context, input }) {
      yield* memoryOn(context.userId);
      const { workspaceId, text, replaces } = input;
      return yield* saveAnswer(
        yield* hostedStoreOrUnavailable(
          saveWorkspaceMemory(context.userId, workspaceId, text, replaces),
        ),
      );
    }),

    searchMemories: signedIn.searchMemories.effect(function* ({ context, input }) {
      yield* memoryOn(context.userId);
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
