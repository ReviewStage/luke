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

/**
 * automation-follow.ts -- a workspace's automations, an automation's runs, or a workspace's runs, followed on the service's live read for as long as the windows hold them, their rows taken as each poll answers them, and a history built again whenever its rows move and whenever the clock alone moves a run's agent.
 *
 * The live read is fetched from the service and followed over its held poll
 * (`live-follow.ts`). The rows are decoded where they arrive and taken the
 * moment their poll answers, before the follow carries the answer's txids
 * on to a write waiting for them, so a write confirmed on a read finds its
 * rows already taken: a workspace's automations by the collection that
 * builds the list (`automation-collections.ts`), and a history by
 * `historyAtEdges`, which builds it (`@repo/features/automation-live`) at
 * the host's own instant, and again at the one instant the clock alone
 * moves a run's agent, the end of a grace.
 *
 * A read the service did not answer is told as unanswered, and asked for
 * again, as a follow that stops for good is started again, after
 * `LIVE_RESTART`. One the account does not reach is told unanswered and
 * ends the follow; one refused because the session is no longer the
 * account the follow started for ends it unsaid, and the next sign-in
 * follows it again.
 */

/** A live read as the follow asks for it, its rows inline; a failure where the service answered none. */
type Sealed<Answer> = Answer | { readonly failure: string };

export interface AutomationFollowDependencies<Part extends string, Rows> {
  /** The read as a live read, or with `poll` its rows inline, held past `after`. */
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed<SealedRead<Part>>>;
  /** Takes the read's rows, decoded, as each poll answers them. */
  readonly take: (rows: Rows) => Effect.Effect<void>;
  /** Tells that the read did not answer, or that the account no longer reaches it. */
  readonly unanswered: () => void;
  /** Hears the follow's wait for a write's transaction where it has one, and none once it is let go. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** A read with one the account no longer reaches marked gone, so its follow ends rather than asks again. */
function goneWhereNotFound<Part extends string>(
  read: Sealed<SealedRead<Part>>,
): SealedRead<Part> | { readonly failure: string; readonly gone: boolean } {
  return "failure" in read
    ? { failure: read.failure, gone: read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND }
    : read;
}

/**
 * Rows followed from the first answer, taken, decoded, the moment each poll
 * answers them, before the follow carries the answer's txids on to a write
 * waiting for them, until the read breaks.
 */
function takenRows<Part extends string, Rows>(
  schema: Schema.Codec<Rows, unknown>,
  dependencies: AutomationFollowDependencies<Part, Rows>,
  first: SealedRead<Part>,
  poll: (
    after: string | undefined,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone: boolean }>,
): Effect.Effect<void, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
  /** Takes an answer's rows, answering whether they decoded; one carrying none inline takes nothing. */
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

/**
 * One read followed, its rows taken as `schema` decodes them, until
 * interrupted or until the service says it never will again: one the
 * account does not reach is told unanswered and ends, and one refused as
 * signed out ends unsaid.
 */
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
    /**
     * Why the follow ended for good, the first poll's terminal failure, kept
     * whatever answers after it, so a follow that ends is told unanswered
     * or ended unsaid.
     */
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
    // A follow the service ended for good, as one whose automation is gone, ends here at once, rather than starting again.
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

/**
 * A history's rows taken as its follow answers them, and the history they
 * make told through `answered` at the host's own instant, and again at
 * each instant the clock alone moves a run's agent, for as long as the
 * scope stands; nothing is told before the rows are first taken. Answers
 * the door the rows are taken by.
 */
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
