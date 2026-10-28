import {
  type TaskListLiveAnswer,
  type TaskListLiveRows,
  taskListLiveRowsSchema,
} from "@luke/features/task-list-live";
import { Effect, Option, Schema, Stream } from "effect";
import { LIVE_GONE, LiveBroken, liveRows, restarting, type TxWait } from "./live-follow.js";

/**
 * task-list-follow.ts -- the task list followed over the service's held poll, each answer's rows taken the moment its poll answers.
 *
 * The read is fetched from the service and followed (`live-follow.ts`); the
 * rows are decoded where they arrive and handed on whole
 * (`task-list-collections.ts` keeps them and builds the list), before the
 * follow carries the answer's txids on to a write waiting for them, so a
 * write confirmed on the list finds its rows already taken.
 *
 * A read the service did not answer is asked for again, and a follow that
 * stops for good started again, after `LIVE_RESTART`. Each says so as it
 * happens: an unanswered read as `failed`, a broken follow or a failed poll
 * as `behind`, until the next rows are taken. A read refused because the
 * session is no longer the account the follow started for ends the follow,
 * which the next sign-in starts again.
 */

/** A read as the follow asks for it, its rows inline; a failure where the service answered none, `gone` where it never will again. */
type Sealed = TaskListLiveAnswer | { readonly failure: string; readonly gone?: boolean };

export interface TaskListFollowDependencies {
  /** The read with its rows inline, fetched from the service, held past `after` where it names one. */
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed>;
  /** Takes each answer's rows, both parts, decoded, as its poll answers. */
  readonly take: (rows: TaskListLiveRows) => Effect.Effect<void>;
  /** That the list could not be read, each time a read goes unanswered; the list already drawn stands. */
  readonly failed: () => void;
  /**
   * That the list drawn may be behind what the service holds: a poll failed
   * and is asked again, or the follow broke and is read again after
   * `LIVE_RESTART`. The next rows taken are caught up.
   */
  readonly behind: () => void;
  /** Hears the list's wait for a write's transaction where it has one, and none once it is let go. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

const decodeRows = Schema.decodeUnknownOption(taskListLiveRowsSchema);

/** An answer's rows decoded; none where it carries none inline, and failed where a row does not decode. */
function rowsOf(read: TaskListLiveAnswer): Option.Option<TaskListLiveRows> | "undecoded" {
  const { plans, agents } = read.queries;
  if (plans.rows === undefined || agents.rows === undefined) return Option.none();
  const rows = decodeRows({ plans: plans.rows, agents: agents.rows });
  return Option.isSome(rows) ? rows : "undecoded";
}

/** The rows each answer carries taken as its poll answers, for as long as the follow stands; it fails where the read is gone or a first row does not decode. */
function followRows(
  dependencies: TaskListFollowDependencies,
  first: TaskListLiveAnswer,
): Effect.Effect<void, LiveBroken> {
  const taken = (read: TaskListLiveAnswer) => {
    const rows = rowsOf(read);
    if (rows === "undecoded") return Effect.succeed(false);
    return Option.isSome(rows)
      ? Effect.as(dependencies.take(rows.value), true)
      : Effect.succeed(true);
  };
  return Effect.gen(function* () {
    if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
    const poll = (after: string | undefined) =>
      Effect.flatMap(dependencies.live(true, after), (read) =>
        "failure" in read
          ? Effect.succeed(read)
          : Effect.map(taken(read), (decoded) =>
              decoded ? read : { failure: "a row did not decode" },
            ),
      );
    const { onTxWait, behind } = dependencies;
    yield* Stream.runDrain(
      liveRows({ poll, behind, ...(onTxWait === undefined ? undefined : { onTxWait }) }, first),
    );
  });
}

/** The task list, followed live until interrupted or until the service says it never will again. */
export function followTaskList(dependencies: TaskListFollowDependencies): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(false);
    if ("failure" in sealed) {
      if (sealed.gone === true) return false;
      dependencies.failed();
      return true;
    }
    // A read the service refused for good, as one under another session, ends the follow rather than starting it again.
    const gone = yield* followRows(dependencies, sealed).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    // A follow that broke draws the list it had until it is read again, so it says the list may be behind.
    if (!gone) dependencies.behind();
    return !gone;
  });
  return restarting(attempt);
}
