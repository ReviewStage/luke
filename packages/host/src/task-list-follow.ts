import {
  type TaskListLiveAnswer,
  type TaskListLiveRows,
  taskListLiveRowsSchema,
} from "@repo/features/task-list-live";
import { Effect, Option, Schema, Stream } from "effect";
import {
  LIVE_GONE,
  LiveBroken,
  liveRows,
  restarting,
  type SyncStanding,
  syncStandingOf,
  type TxWait,
} from "./live-follow.js";

type Sealed = TaskListLiveAnswer | { readonly failure: string; readonly gone?: boolean };

export interface TaskListFollowDependencies {
  readonly live: (sync: string | undefined) => Effect.Effect<Sealed>;
  readonly from?: string;
  readonly take: (rows: TaskListLiveRows, standing?: SyncStanding) => Effect.Effect<void>;
  readonly failed: () => void;
  readonly behind: () => void;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

const decodeRows = Schema.decodeUnknownOption(taskListLiveRowsSchema);

function rowsOf(read: TaskListLiveAnswer): Option.Option<TaskListLiveRows> | "undecoded" {
  const { plans, agents } = read.queries;
  if (plans.rows === undefined || agents.rows === undefined) return Option.none();
  const rows = decodeRows({ plans: plans.rows, agents: agents.rows });
  return Option.isSome(rows) ? rows : "undecoded";
}

function followRows(
  dependencies: TaskListFollowDependencies,
  first: TaskListLiveAnswer,
): Effect.Effect<void, LiveBroken> {
  const taken = (read: TaskListLiveAnswer) => {
    const rows = rowsOf(read);
    if (rows === "undecoded") return Effect.succeed(false);
    return Option.isSome(rows)
      ? Effect.as(dependencies.take(rows.value, syncStandingOf(read)), true)
      : Effect.succeed(true);
  };
  return Effect.gen(function* () {
    if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
    const poll = (_after: string | undefined, _cursor?: string, sync?: string) =>
      Effect.flatMap(dependencies.live(sync), (read) =>
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

export function followTaskList(dependencies: TaskListFollowDependencies): Effect.Effect<void> {
  let past = dependencies.from;
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(past ?? "");
    past = undefined;
    if ("failure" in sealed) {
      if (sealed.gone === true) return false;
      dependencies.failed();
      return true;
    }
    const gone = yield* followRows(dependencies, sealed).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    if (!gone) dependencies.behind();
    return !gone;
  });
  return restarting(attempt);
}
