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

/**
 * description-document-reads.ts -- each task's description the windows opened, held per task, so a task opened again draws its description in its first frame.
 *
 * A window holds the description of the task it has open (`LIVE_READ.DESCRIPTION_DOCUMENT`),
 * and the host keeps it followed while any window holds it and among the
 * few let go latest after (`heldSlice`). No live query carries the text: the
 * task's record is followed over the service's held poll
 * (`task-record-follow.ts`), whose description mark moves with each save, and the
 * description is read again where its last save is newer than the copy held. One
 * nothing holds a copy of is read at once, beside the record's first seal.
 *
 * The host's own writes of a task, a rename, a pin, a block, a restore, or
 * the developer's edit, are laid on its description wherever it is held, as the
 * service answered them. A read lands only where both hold: it answers a
 * save at least as new as the copy held, and no write of the task landed
 * since it left, which each task's numbers keep (`laidNow`). Note that the
 * last save alone cannot order a read against a write that leaves it as it
 * stood, a rename's or a pin's, so it would put back the older name or pin.
 * And while the record has not yet carried an edit's transaction, no
 * delivery of it reads the description, so the edit stands until the record shows it.
 */

/** A task the account no longer reaches, as its held description says it. */
const DESCRIPTION_GONE: HeldDescriptionDocument = { gone: true };

/** Why a read of a description lands nothing: a write landed since it left, or the copy held answers a newer save. */
const OVERTAKEN = "overtaken";

/** A record the service did not seal, `gone` where the task is no longer the account's or the session another's. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** One task's description as its follow stands. */
interface Followed {
  /** When the description was last saved, as the record last delivered it; none before it delivers. */
  descriptionSavedAt: number | undefined;
  /** How many reads of the description started, and the newest of them laid, a write counted as one that started and landed. */
  started: number;
  laid: number;
  /** The record's wait for a write's transaction, once it hands one. */
  txWait: TxWait | undefined;
  /** How many edits wait for the record to carry their transaction. */
  confirming: number;
  /** Asks the description read again, where it was saved past the copy held. */
  readonly ask: () => void;
}

export interface DescriptionDocumentReadsDependencies {
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The account signed in now, by its id, which every seal names; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** The task whole, its description among it, as the service holds it now. */
  readonly open: (taskId: string) => Effect.Effect<TaskCallResult<Task, TaskCallFailure>>;
  /** The task's record with its rows inline, held past `after`. */
  readonly recordLive: (
    taskId: string,
    userId: string,
    poll: boolean,
    after: string | undefined,
  ) => Effect.Effect<
    TaskCallResult<TaskRecordLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>
  >;
  /** `task` with what its row of the list reads laid over it, its name, status, and pin among it; the very task where the list holds no row of it. */
  readonly listed: (task: Task) => Task;
  readonly tell: (held: AppDescriptionDocuments) => void;
}

export interface DescriptionDocumentReads {
  /** Holds `taskId`'s description for the windows until `unfollow`, following it unless it stands. */
  readonly follow: (taskId: string) => Effect.Effect<void>;
  readonly unfollow: (taskId: string) => Effect.Effect<void>;
  /** Reads `taskId`'s description again at once, as Try again asks. */
  readonly retry: (taskId: string) => Effect.Effect<void>;
  /** Follows every held description anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every follow go and holds no description: the session ended. The windows' holds stand, for `open`. */
  readonly end: Effect.Effect<void>;
  /** `taskId`'s description as held now; none where none is, or the task is gone. */
  readonly heldTask: (taskId: string) => Task | undefined;
  /**
   * Lays a write's answer of `taskId` where its description is held, as `laid`
   * answers it over the copy held, or none where a read of it is still out;
   * nothing where `laid` answers none. No read that left before it lands.
   */
  readonly written: (taskId: string, laid: (held: Task | undefined) => Task | undefined) => void;
  /** Lays a task this Mac started as held, and holds it until a window takes the hold, so the task opens on its description. */
  readonly started: (task: Task) => Effect.Effect<void>;
  /** Lays what each held task's row of the list now reads over its description. */
  readonly relisted: () => void;
  /** Waits for the edit's transaction to reach `taskId`'s record, no delivery reading its description meanwhile; at once where none is followed. */
  readonly confirmed: (taskId: string, txid: string | undefined) => Effect.Effect<void>;
}

/** Each task's description the windows hold, followed and laid on their app state. */
export const descriptionDocumentReads = /* @__PURE__ */ Effect.fn("host/descriptionDocumentReads")(
  function* (
    dependencies: DescriptionDocumentReadsDependencies,
  ): Effect.fn.Return<DescriptionDocumentReads, never, Scope.Scope> {
    const { gate } = dependencies;
    /** Each held task's follow, by the task. */
    const followed = new Map<string, Followed>();

    /** Whether the read numbered `read` is still the newest of `entry`'s to land, which it then is; false where a newer one, or a write, landed first. */
    function laidNow(entry: Followed, read: number): boolean {
      if (read < entry.laid) return false;
      entry.laid = read;
      return true;
    }

    /** Whether `taskId`'s description is to be read: none is held, or the record delivered a save newer than the copy held, and no edit waits on the record. */
    function wanted(taskId: string, entry: Followed): boolean {
      if (!gate() || entry.confirming > 0) return false;
      const rows = held.rowsOf(taskId);
      if (rows === undefined) return true;
      if (!("task" in rows)) return false;
      return (
        entry.descriptionSavedAt !== undefined && entry.descriptionSavedAt > rows.task.updatedAt
      );
    }

    /**
     * Reads `taskId`'s description where it is wanted, asked again on
     * `FOLLOW_BACKOFF` while it stays wanted after a read that failed or was
     * overtaken, since the record delivers no other move for a mark that stood
     * still. A task the account no longer reaches is gone where no copy is
     * held, and keeps its copy otherwise.
     */
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

    /**
     * Follows `taskId`'s record, each move of its description's last save handed to
     * `entry`. A seal the service did not answer, or a follow that stops
     * before it delivered, is sealed again on `FOLLOW_BACKOFF`; one that
     * delivered and then stopped is sealed again after `FOLLOW_RESEAL.FIRST`,
     * its backoff started over. A task the account no longer reaches, a
     * session that is another's, or a gate that closed ends it.
     */
    function followRecord(taskId: string, entry: Followed): Effect.Effect<void> {
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.accountId();
      const seal = (
        poll: boolean,
        after?: string,
      ): Effect.Effect<TaskRecordLiveAnswer | Unsealed> =>
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
      /** One seal followed until it stops: whether it delivered, or why it never did. */
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

    /**
     * Follows `taskId`'s description until it is let go: its record, and a read of
     * its description wherever the record moved it past the copy held, one at a
     * time, an ask meanwhile waiting for the read out. Note that a record
     * that ends, as one of a task the account no longer reaches does, leaves
     * the description held, since a read and the host's writes still lay on it.
     */
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
            Effect.forever(
              Effect.andThen(Queue.take(asked), readWhereSaved(taskId, entry, answers)),
            ),
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
    /** The windows' hold on each task's description, one fiber standing until let go. */
    const holds = yield* FiberMap.make<string>();

    const follow = (taskId: string) =>
      Effect.asVoid(
        FiberMap.run(
          holds,
          taskId,
          Effect.scoped(Effect.andThen(held.hold(taskId), Effect.never)),
          {
            onlyIfMissing: true,
          },
        ),
      );

    /** `taskId`'s description as held now; none where none is, or the task is gone. */
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
        // Note that a write counts as a read that started and landed, so no read that left before it lands over it.
        if (entry !== undefined) {
          entry.started += 1;
          entry.laid = entry.started;
        }
        held.lay(taskId, { task });
      },
      // Note that the task is laid before a window opens it, and held by the host meanwhile, so the window's first frame of it draws its description; the window's own hold then joins this one, and its letting go lets the description go.
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
  },
);
