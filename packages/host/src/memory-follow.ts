import {
  AGENT_CALL_FAILURE,
  type MemoriesAnswerView,
  type MemoryForgetParams,
} from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type MemoryLiveRow,
  memoriesOfLiveRows,
  type WorkspaceMemoriesLiveAnswer,
  workspaceMemoriesLiveRowsSchema,
} from "@repo/features/memory-live";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect, type Scope } from "effect";
import { type AppHostReads, type AppMemories, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type TxWait,
} from "./live-follow.js";

const MEMORY = fieldKind((row: MemoryLiveRow) => row.id);

interface MemoriesUnanswered {
  readonly failure: string;
}

export interface MemoriesFollowDependencies {
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceMemoriesLiveAnswer | MemoriesUnanswered>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly tell: (held: AppMemories) => void;
}

function endsFollow(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

function followMemories(
  dependencies: MemoriesFollowDependencies,
  workspaceId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.MEMORIES]>,
): Effect.Effect<void> {
  const userId = dependencies.accountId();
  const seal = (poll: boolean, after?: string) =>
    userId === undefined
      ? Effect.succeed(LIVE_SIGNED_OUT)
      : dependencies.seal(workspaceId, userId, poll, after);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* seal(false);
      if ("failure" in first) {
        if (first.failure === LIVE_SIGNED_OUT.failure) return false;
        answers.unanswered();
        return first.failure !== AGENT_CALL_FAILURE.NOT_FOUND;
      }
      let wait: TxWait | undefined;
      let answered = false;
      let endedBy: string | undefined;
      const drawn: Effect.Effect<void> = Effect.sync(() => {
        if (answered) answers.answered(memoriesOfLiveRows(memories.rows()));
      });
      const memories: HeldRows<MemoryLiveRow> = yield* dependencies.pool.stand(MEMORY, {
        redraw: () => drawn,
        confirmation: () => {
          const handed = wait;
          return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
        },
      });
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(seal(true, after), (read) => {
              if (!("failure" in read)) return read;
              const ends = endsFollow(read.failure);
              if (ends && endedBy === undefined) endedBy = read.failure;
              return { failure: read.failure, gone: ends };
            }),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        workspaceMemoriesLiveRowsSchema,
        (rows) =>
          Effect.andThen(
            memories.answer(rows.memories),
            Effect.suspend(() => {
              answered = true;
              return drawn;
            }),
          ),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      if (!gone) return true;
      if (endedBy === AGENT_CALL_FAILURE.NOT_FOUND) answers.unanswered();
      return false;
    }),
  );
  return restarting(attempt);
}

export function heldMemories(
  dependencies: MemoriesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.MEMORIES, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate: dependencies.gate,
    follow: (workspaceId, answers) => followMemories(dependencies, workspaceId, answers),
    tell: dependencies.tell,
  });
}

export function memoryForget(
  send: (forget: MemoryForgetParams) => Effect.Effect<MemoriesAnswerView>,
): WriteDeclaration<MemoryLiveRow, FieldChange<MemoryLiveRow>, MemoryForgetParams, WireValue> {
  return {
    kind: MEMORY,
    keys: (forget) => [forget.id],
    change: () => () => ROW_GONE,
    send: (forget) =>
      Effect.map(send(forget), (answer) =>
        "memories" in answer
          ? { answer: carried<MemoriesAnswerView>(answer), txid: answer.txid }
          : { refused: carried<MemoriesAnswerView>(answer) },
      ),
  };
}
