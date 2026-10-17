import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  planAgentsOfLiveRows,
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
 * task-list-follow.ts -- the plan list followed over Neon Realtime as Neon's guide says to, built again whenever its rows move and whenever the clock alone moves an agent's status.
 *
 * The sealed statements are fetched from the service and followed
 * (`live-follow.ts`); the rows are decoded where they arrive and the list
 * is built from them (`@luke/features/task-list-live`) at the host's own
 * instant. An agent with no turn yet reads starting through its grace and
 * failed past it with no row moving, so the list is built again at that
 * edge too: the one clock left here, armed only while such an agent
 * stands. The sealed statements stay here, where the account's own bearer
 * is; only the list built from the rows leaves.
 *
 * A service that seals nothing, an older one or one whose deployment has no
 * Realtime, leaves the list to the reads it was read by before, and is
 * asked again every `LIVE_RETRY`; a subscription that stops for good is
 * started again after `LIVE_RESTART`, the reads standing in meanwhile.
 */

/** How long the reads stand in before the live list is asked for again. */
const LIVE_RETRY = Duration.minutes(5);
/** How long after a subscription stopped for good it is started again. */
const LIVE_RESTART = Duration.seconds(5);

/** The list as the live rows make it at one instant, and every agent on a plan beside it. */
interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly planAgents: readonly CodingAgentSummary[];
}

export interface TaskListFollowDependencies {
  /** The sealed statements, fetched from the service; a failure where it answered none. */
  readonly live: () => Effect.Effect<TaskListLiveAnswer | { readonly failure: string }>;
  readonly openLive: (url: string) => LiveClient;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The list, and every agent on a plan as its plan's own list names it, each time the rows or the clock move them. */
  readonly publish: (read: LiveTaskList) => void;
  /** Whether the list stands live, said as it starts and as it stops, so the reads stand in only while it does not. */
  readonly standing: (live: boolean) => void;
}

/** The list the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function listsOf(rows: TaskListLiveRows): Stream.Stream<LiveTaskList> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed({
        list: taskListOfLiveRows(rows, at),
        planAgents: planAgentsOfLiveRows(rows, at),
      });
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
): Stream.Stream<LiveTaskList, LiveBroken> {
  const decode = Schema.decodeUnknownOption(taskListLiveRowsSchema);
  const rows = liveRows(
    { openLive: dependencies.openLive, reseal: dependencies.live, now: dependencies.now },
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

/** The plan list, followed until interrupted: live where the service seals it, and left to the reads where it does not. */
export function followTaskList(dependencies: TaskListFollowDependencies): Effect.Effect<never> {
  const stopped = Effect.sync(() => dependencies.standing(false));
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live();
    if ("failure" in sealed) return yield* Effect.sleep(LIVE_RETRY);
    yield* Stream.runForEach(liveLists(dependencies, sealed), (read) =>
      Effect.sync(() => {
        dependencies.standing(true);
        dependencies.publish(read);
      }),
    ).pipe(Effect.catch(() => Effect.void));
    yield* stopped;
    yield* Effect.sleep(LIVE_RESTART);
  });
  return Effect.forever(attempt).pipe(Effect.ensuring(stopped));
}
