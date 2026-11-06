import { AUTOMATION_CALL_FAILURE } from "@repo/features/automation-view";
import { LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { Effect, Option, Schema, type Scope, Stream } from "effect";
import { drawnAtEdges } from "./live-collection.js";
import {
  LIVE_GONE,
  LiveBroken,
  liveRows,
  restarting,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

type Sealed<Answer> = Answer | { readonly failure: string };

export interface AutomationFollowDependencies<Part extends string, Rows> {
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed<SealedRead<Part>>>;
  readonly take: (rows: Rows) => Effect.Effect<void>;
  readonly unanswered: () => void;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

function goneWhereNotFound<Part extends string>(
  read: Sealed<SealedRead<Part>>,
): SealedRead<Part> | { readonly failure: string; readonly gone: boolean } {
  return "failure" in read
    ? { failure: read.failure, gone: read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND }
    : read;
}

function takenRows<Part extends string, Rows>(
  schema: Schema.Codec<Rows, unknown>,
  dependencies: AutomationFollowDependencies<Part, Rows>,
  first: SealedRead<Part>,
  poll: (
    after: string | undefined,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone: boolean }>,
): Effect.Effect<void, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  const taken = (read: SealedRead<Part>) => {
    const parts = Object.entries<{ readonly rows?: readonly unknown[] }>(read.queries);
    if (parts.some(([, query]) => query.rows === undefined)) return Effect.succeed(true);
    const rows = decode(Object.fromEntries(parts.map(([part, query]) => [part, query.rows])));
    return Option.isSome(rows)
      ? Effect.as(dependencies.take(rows.value), true)
      : Effect.succeed(false);
  };
  return Effect.gen(function* () {
    if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
    const takenPoll = (after: string | undefined) =>
      Effect.flatMap(poll(after), (read) =>
        "failure" in read
          ? Effect.succeed(read)
          : Effect.map(taken(read), (decoded) =>
              decoded ? read : { failure: "a row did not decode" },
            ),
      );
    const onTxWait = dependencies.onTxWait;
    yield* Stream.runDrain(
      liveRows({ poll: takenPoll, ...(onTxWait === undefined ? undefined : { onTxWait }) }, first),
    );
  });
}

export function followAutomationRead<Part extends string, Rows>(
  schema: Schema.Codec<Rows, unknown>,
  dependencies: AutomationFollowDependencies<Part, Rows>,
): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(false);
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return false;
      dependencies.unanswered();
      return sealed.failure !== AUTOMATION_CALL_FAILURE.NOT_FOUND;
    }
    let endedBy: string | undefined;
    const noted = (read: Sealed<SealedRead<Part>>) => {
      if (
        endedBy === undefined &&
        "failure" in read &&
        (read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND ||
          read.failure === LIVE_SIGNED_OUT.failure)
      ) {
        endedBy = read.failure;
      }
      return goneWhereNotFound(read);
    };
    const gone = yield* takenRows(schema, dependencies, sealed, (after) =>
      Effect.map(dependencies.live(true, after), noted),
    ).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    if (gone) {
      if (endedBy === AUTOMATION_CALL_FAILURE.NOT_FOUND) dependencies.unanswered();
      return false;
    }
    return true;
  });
  return restarting(attempt);
}

export function historyAtEdges<Rows, History>(
  build: (rows: Rows, now: number) => History,
  edge: (rows: Rows, now: number) => number | undefined,
  answered: (history: History) => void,
): Effect.Effect<(rows: Rows) => Effect.Effect<void>, never, Scope.Scope> {
  return Effect.gen(function* () {
    let taken: Option.Option<Rows> = Option.none();
    const drawn = yield* drawnAtEdges((at) => {
      if (Option.isNone(taken)) return undefined;
      answered(build(taken.value, at));
      return edge(taken.value, at);
    });
    return (rows) =>
      Effect.suspend(() => {
        taken = Option.some(rows);
        return drawn;
      });
  });
}
