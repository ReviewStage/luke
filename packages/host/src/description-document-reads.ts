import type { TaskCallResult } from "@repo/features";
import {
  type LIVE_READ,
  LIVE_SIGNED_OUT,
  type TaskRecordLiveAnswer,
} from "@repo/features/live-wire";
import type { Task } from "@repo/features/task-wire";
import {
  type HeldDescriptionDocument,
  TASK_CALL_FAILURE,
  type TaskCallFailure,
} from "@repo/features/tasks-view";
import { Effect, Equal, FiberMap, Option, Queue, Schedule, type Scope, Stream } from "effect";
import { type AppDescriptionDocuments, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, heldSlice } from "./live-collection.js";
import { confirmWrite, FOLLOW_BACKOFF, FOLLOW_RESEAL, type TxWait } from "./live-follow.js";
import { taskRecordMoves } from "./task-record-follow.js";

const DESCRIPTION_GONE: HeldDescriptionDocument = { gone: true };

const OVERTAKEN = "overtaken";

type Unsealed = { readonly failure: string; readonly gone?: boolean };

interface Followed {
  descriptionSavedAt: number | undefined;
  started: number;
  laid: number;
  txWait: TxWait | undefined;
  confirming: number;
  readonly ask: () => void;
}

export interface DescriptionDocumentReadsDependencies {
  readonly gate: () => boolean;
  readonly accountId: () => string | undefined;
  readonly open: (taskId: string) => Effect.Effect<TaskCallResult<Task, TaskCallFailure>>;
  readonly recordLive: (
    taskId: string,
    userId: string,
    poll: boolean,
    after: string | undefined,
  ) => Effect.Effect<
    TaskCallResult<TaskRecordLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>
  >;
  readonly listed: (task: Task) => Task;
  readonly tell: (held: AppDescriptionDocuments) => void;
}

export interface DescriptionDocumentReads {
  readonly follow: (taskId: string) => Effect.Effect<void>;
  readonly unfollow: (taskId: string) => Effect.Effect<void>;
  readonly retry: (taskId: string) => Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
  readonly heldTask: (taskId: string) => Task | undefined;
  readonly written: (taskId: string, laid: (held: Task | undefined) => Task | undefined) => void;
  readonly started: (task: Task) => Effect.Effect<void>;
  readonly relisted: () => void;
  readonly confirmed: (taskId: string, txid: string | undefined) => Effect.Effect<void>;
}

export const descriptionDocumentReads = Effect.fn("host/descriptionDocumentReads")(function* (
  dependencies: DescriptionDocumentReadsDependencies,
): Effect.fn.Return<DescriptionDocumentReads, never, Scope.Scope> {
  const { gate } = dependencies;
  const followed = new Map<string, Followed>();

  function laidNow(entry: Followed, read: number): boolean {
    if (read < entry.laid) return false;
    entry.laid = read;
    return true;
  }

  function wanted(taskId: string, entry: Followed): boolean {
    if (!gate() || entry.confirming > 0) return false;
    const rows = held.rowsOf(taskId);
    if (rows === undefined) return true;
    if (!("task" in rows)) return false;
    return entry.descriptionSavedAt !== undefined && entry.descriptionSavedAt > rows.task.updatedAt;
  }

  function readWhereSaved(
    taskId: string,
    entry: Followed,
    answers: HeldAnswers<HeldDescriptionDocument>,
  ) {
    const once = Effect.gen(function* () {
      if (!wanted(taskId, entry)) return;
      entry.started += 1;
      const read = entry.started;
      const opened = yield* dependencies.open(taskId);
      if (!opened.ok) {
        if (opened.failure !== TASK_CALL_FAILURE.NOT_FOUND) {
          answers.unanswered();
          return yield* Effect.fail(opened.failure);
        }
        if (held.rowsOf(taskId) === undefined && laidNow(entry, read))
          answers.answered(DESCRIPTION_GONE);
        return;
      }
      const standing = held.rowsOf(taskId);
      const older =
        standing !== undefined &&
        "task" in standing &&
        opened.answer.updatedAt < standing.task.updatedAt;
      if (older || !laidNow(entry, read)) return yield* Effect.fail(OVERTAKEN);
      answers.answered({ task: dependencies.listed(opened.answer) });
    });
    return Effect.ignore(
      Effect.retry(once, { schedule: FOLLOW_BACKOFF, while: () => wanted(taskId, entry) }),
    );
  }

  function followRecord(taskId: string, entry: Followed): Effect.Effect<void> {
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string): Effect.Effect<TaskRecordLiveAnswer | Unsealed> =>
      userId === undefined
        ? Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true })
        : Effect.map(dependencies.recordLive(taskId, userId, poll, after), (sealed) =>
            sealed.ok
              ? sealed.answer
              : {
                  failure: sealed.failure,
                  gone:
                    sealed.failure === TASK_CALL_FAILURE.NOT_FOUND ||
                    sealed.failure === LIVE_SIGNED_OUT.failure,
                },
          );
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed);
      let delivered = false;
      const moves = taskRecordMoves(
        {
          poll: (after) => seal(true, after),
          onTxWait: (wait) => {
            entry.txWait = wait;
          },
        },
        sealed,
      );
      yield* Stream.runForEach(moves, ({ descriptionSavedAt }) =>
        Effect.sync(() => {
          delivered = true;
          if (descriptionSavedAt === undefined) return;
          entry.descriptionSavedAt = descriptionSavedAt;
          entry.ask();
        }),
      ).pipe(Effect.ignore);
      if (!delivered)
        return yield* Effect.fail<Unsealed>({ failure: TASK_CALL_FAILURE.UNANSWERED });
      return true;
    });
    const followedRecord = attempt.pipe(
      Effect.retry({ schedule: FOLLOW_BACKOFF, while: (why) => why.gone !== true && gate() }),
      Effect.option,
    );
    return Effect.asVoid(
      Effect.repeat(followedRecord, {
        schedule: Schedule.spaced(FOLLOW_RESEAL.FIRST),
        while: (delivered) => Option.isSome(delivered) && gate(),
      }),
    );
  }

  function followDescription(taskId: string, answers: HeldAnswers<HeldDescriptionDocument>) {
    return Effect.scoped(
      Effect.gen(function* () {
        const asked = yield* Queue.sliding<true>(1);
        const entry: Followed = {
          descriptionSavedAt: undefined,
          started: 0,
          laid: 0,
          txWait: undefined,
          confirming: 0,
          ask: () => {
            Queue.offerUnsafe(asked, true);
          },
        };
        followed.set(taskId, entry);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (followed.get(taskId) === entry) followed.delete(taskId);
          }),
        );
        yield* Effect.forkScoped(
          Effect.forever(Effect.andThen(Queue.take(asked), readWhereSaved(taskId, entry, answers))),
        );
        entry.ask();
        yield* followRecord(taskId, entry);
        return yield* Effect.never;
      }),
    );
  }

  const held = yield* heldSlice<typeof LIVE_READ.DESCRIPTION_DOCUMENT, string>({
    empty: NO_KEYS_HELD,
    path: (taskId) => [taskId],
    gate,
    follow: followDescription,
    tell: dependencies.tell,
  });
  const holds = yield* FiberMap.make<string>();

  const follow = (taskId: string) =>
    Effect.asVoid(
      FiberMap.run(holds, taskId, Effect.scoped(Effect.andThen(held.hold(taskId), Effect.never)), {
        onlyIfMissing: true,
      }),
    );

  const heldTask = (taskId: string): Task | undefined => {
    const rows = held.rowsOf(taskId);
    return rows !== undefined && "task" in rows ? rows.task : undefined;
  };

  return {
    follow,
    unfollow: (taskId) => FiberMap.remove(holds, taskId),
    retry: held.retry,
    open: held.open,
    end: held.end,
    heldTask,
    written: (taskId, laid) => {
      const rows = held.rowsOf(taskId);
      const entry = followed.get(taskId);
      if (rows === undefined ? entry === undefined : !("task" in rows)) return;
      const task = laid(heldTask(taskId));
      if (task === undefined) return;
      if (entry !== undefined) {
        entry.started += 1;
        entry.laid = entry.started;
      }
      held.lay(taskId, { task });
    },
    started: (task) =>
      Effect.suspend(() => {
        held.lay(task.id, { task });
        return follow(task.id);
      }),
    relisted: () => {
      for (const taskId of followed.keys()) {
        const task = heldTask(taskId);
        if (task === undefined) continue;
        const listed = dependencies.listed(task);
        if (!Equal.equals(listed, task)) held.lay(taskId, { task: listed });
      }
    },
    confirmed: (taskId, txid) =>
      Effect.suspend(() => {
        const entry = followed.get(taskId);
        if (entry === undefined) return Effect.void;
        entry.confirming += 1;
        return confirmWrite(entry.txWait, txid).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.confirming -= 1;
              entry.ask();
            }),
          ),
        );
      }),
  };
});
