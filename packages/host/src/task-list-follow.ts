import {
  type TaskListLiveAnswer,
  type TaskListLiveRows,
  taskListGraceEdge,
  taskListLiveRowsSchema,
  taskListOfLiveRows,
} from "@luke/features/task-list-live";
import type { TaskListAnswer } from "@luke/features/task-wire";
import { Clock, Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * task-list-follow.ts -- the task list followed over Neon Realtime as Neon's guide says to, built again whenever its rows move and whenever the clock alone moves an agent's status.
 *
 * The sealed statements are fetched from the service and followed
 * (`live-follow.ts`); the rows are decoded where they arrive and the list
 * is built from them (`@luke/features/task-list-live`) at the host's own
 * instant. An agent with no turn yet reads starting through its grace and
 * failed past it, and one whose line no turn takes reads running through
 * the line's grace and failed past it, each with no row moving, so the list
 * is built again at the nearest such edge too (`statusClockEdge`): the one
 * clock left here, armed only while such an agent stands. The sealed statements stay here, where the account's own bearer
 * is; only the list built from the rows leaves.
 *
 * A seal the service did not answer is asked for again, and a subscription
 * that stops for good started again, after `LIVE_RESTART`; while Realtime
 * fails it, the rows are polled inline (`live-follow.ts`). A seal refused
 * because the session is no longer the account the follow started for ends
 * the follow, which the next sign-in starts again.
 */

/** How long after a seal went unanswered, or a subscription stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

/** A seal as the follow asks for it: sealed, or with `poll` its rows inline; a failure where the service answered none, `gone` where it never will again. */
type Sealed = TaskListLiveAnswer | { readonly failure: string; readonly gone?: boolean };

export interface TaskListFollowDependencies {
  /** The sealed statements, or with `poll` their rows inline, fetched from the service. */
  readonly live: (poll: boolean) => Effect.Effect<Sealed>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The list, each time its rows or the clock move it. */
  readonly publish: (list: TaskListAnswer) => void;
}

/** The list the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function listsOf(rows: TaskListLiveRows): Stream.Stream<TaskListAnswer> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(taskListOfLiveRows(rows, at));
      const edge = taskListGraceEdge(rows, at);
      if (edge === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(edge - at)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => listsOf(rows)),
      );
    }),
  );
}

/** The lists the live rows make, for as long as the subscriptions stand; it fails where one stops for good or a row does not decode. */
function liveLists(
  dependencies: TaskListFollowDependencies,
  first: TaskListLiveAnswer,
): Stream.Stream<TaskListAnswer, LiveBroken> {
  const decode = Schema.decodeUnknownOption(taskListLiveRowsSchema);
  const rows = liveRows(
    {
      openLive: dependencies.openLive,
      reseal: () => dependencies.live(false),
      poll: () => dependencies.live(true),
      now: dependencies.now,
    },
    first,
  ).pipe(
    Stream.mapEffect((read) =>
      Option.match(decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: Effect.succeed,
      }),
    ),
  );
  return Stream.switchMap(rows, listsOf);
}

/** The task list, followed live until interrupted or until the service says it never will again. */
export function followTaskList(dependencies: TaskListFollowDependencies): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(false);
    if ("failure" in sealed) {
      if (sealed.gone === true) return false;
      yield* Effect.sleep(LIVE_RESTART);
      return true;
    }
    yield* Stream.runForEach(liveLists(dependencies, sealed), (list) =>
      Effect.sync(() => dependencies.publish(list)),
    ).pipe(Effect.catch(() => Effect.void));
    yield* Effect.sleep(LIVE_RESTART);
    return true;
  });
  return Effect.asVoid(Effect.repeat(attempt, { while: (again) => again }));
}
