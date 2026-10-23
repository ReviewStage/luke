import {
  type AutomationRunsLiveAnswer,
  type AutomationsLiveAnswer,
  automationRunsGraceEdge,
  automationRunsLiveRowsSchema,
  automationRunsOfLiveRows,
  automationsGraceEdge,
  automationsLiveRowsSchema,
  automationsOfLiveRows,
} from "@luke/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationFollow,
  type AutomationFollowed,
} from "@luke/features/automation-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Clock, Duration, Effect, type Schema, Stream } from "effect";
import {
  decodedLiveRows,
  LIVE_GONE,
  type LiveClient,
  liveShown,
  restarting,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

/**
 * automation-follow.ts -- a workspace's automations, or an automation's runs, followed on the service's live read for the windows that draw them, built again whenever the rows move and whenever the clock alone moves a run's agent.
 *
 * The live read is fetched from the service and followed (`live-follow.ts`):
 * held polls while Realtime is off, a subscription where it is on. The rows
 * are decoded where they arrive, and the list or the history is built from
 * them (`@luke/features/automation-live`) at the host's own instant, and
 * again at the one instant the clock alone moves a run's agent, the end of
 * a grace. Only what is built from the rows leaves here.
 *
 * A read the service did not answer is told as unanswered, which the window
 * says while it holds nothing, and asked for again, as a follow that stops
 * for good is started again, after `LIVE_RESTART`. One the account does not
 * reach is told not found and ends the follow; one refused because the
 * session is no longer the account the follow started for ends it unsaid,
 * and the next sign-in's window follows it again.
 */

/** A live read as the follow asks for it: sealed, or with `poll` its rows inline; a failure where the service answered none. */
type Sealed<Answer> = Answer | { readonly failure: string };

export interface AutomationFollowDependencies {
  /** A workspace's automations as a live read, or with `poll` their rows inline, held past `after`. */
  readonly liveList: (
    workspaceId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed<AutomationsLiveAnswer>>;
  /** An automation's runs as a live read, or with `poll` their rows inline, held past `after`. */
  readonly liveRuns: (
    automationId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed<AutomationRunsLiveAnswer>>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The service's origin, which a webhook automation's address is written on. */
  readonly serviceBaseUrl: string;
  /** What was followed, each time it moves. */
  readonly publish: (followed: AutomationFollowed) => void;
  /** Hears the follow's wait for a write's transaction once it is subscribed, and none once it is let go or polled. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** One kind of follow: how it is read, decoded, built, and published. */
interface FollowKind<Part extends string, Rows, View> {
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed<SealedRead<Part>>>;
  readonly rows: Schema.Codec<Rows, unknown>;
  readonly build: (rows: Rows, now: number) => View;
  readonly edge: (rows: Rows, now: number) => number | undefined;
  readonly publish: (view: View) => void;
  /** Why there is nothing to draw, told as the view says it. */
  readonly failed: (
    failure: typeof AUTOMATION_CALL_FAILURE.UNANSWERED | typeof AUTOMATION_CALL_FAILURE.NOT_FOUND,
  ) => void;
}

/** A read with one the account no longer reaches marked gone, so its follow ends rather than asks again. */
function goneWhereNotFound<Part extends string>(
  read: Sealed<SealedRead<Part>>,
): SealedRead<Part> | { readonly failure: string; readonly gone: boolean } {
  return "failure" in read
    ? { failure: read.failure, gone: read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND }
    : read;
}

/** The view the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function viewsOf<Rows, View>(
  kind: FollowKind<string, Rows, View>,
  rows: Rows,
): Stream.Stream<View> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(kind.build(rows, at));
      const edge = kind.edge(rows, at);
      if (edge === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(edge - at)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => viewsOf(kind, rows)),
      );
    }),
  );
}

/** One follow until interrupted or until the service says it never will again. */
function followed<Part extends string, Rows, View>(
  dependencies: AutomationFollowDependencies,
  kind: FollowKind<Part, Rows, View>,
): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* kind.live(false);
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return false;
      if (sealed.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND) {
        kind.failed(AUTOMATION_CALL_FAILURE.NOT_FOUND);
        return false;
      }
      kind.failed(AUTOMATION_CALL_FAILURE.UNANSWERED);
      return true;
    }
    /**
     * Why the follow ended for good, the first renewal's or poll's terminal
     * failure, kept whatever answers after it, since a poll and a renewal may
     * run side by side; so a follow that ends is told as not found or ended unsaid.
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
    const rows = decodedLiveRows(
      {
        openLive: dependencies.openLive,
        reseal: () => Effect.map(kind.live(false), noted),
        poll: (after) => Effect.map(kind.live(true, after), noted),
        now: dependencies.now,
        onTxWait: dependencies.onTxWait,
      },
      sealed,
      kind.rows,
    );
    // A follow the service ended for good, as one whose automation is gone, ends here at once, rather than starting again.
    const gone = yield* Stream.runForEach(
      liveShown(Stream.switchMap(rows, (decoded) => viewsOf(kind, decoded))),
      (view) => Effect.sync(() => kind.publish(view)),
    ).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    if (gone) {
      if (endedBy === AUTOMATION_CALL_FAILURE.NOT_FOUND) {
        kind.failed(AUTOMATION_CALL_FAILURE.NOT_FOUND);
      }
      return false;
    }
    return true;
  });
  return restarting(attempt);
}

/** What the window follows, followed until interrupted or signed out, each change published under what it is of. */
export function followAutomations(
  dependencies: AutomationFollowDependencies,
  scope: AutomationFollow,
): Effect.Effect<void> {
  switch (scope.kind) {
    case AUTOMATION_FOLLOW.WORKSPACE:
      return followed(dependencies, {
        live: (poll, after) => dependencies.liveList(scope.id, poll, after),
        rows: automationsLiveRowsSchema,
        build: (rows, now) => ({
          automations: automationsOfLiveRows(rows, now, dependencies.serviceBaseUrl),
        }),
        edge: automationsGraceEdge,
        publish: (view) => dependencies.publish({ scope, view }),
        failed: (failure) => dependencies.publish({ scope, view: { failure } }),
      });
    case AUTOMATION_FOLLOW.RUNS:
      return followed(dependencies, {
        live: (poll, after) => dependencies.liveRuns(scope.id, poll, after),
        rows: automationRunsLiveRowsSchema,
        build: (rows, now) => ({ runs: automationRunsOfLiveRows(rows, now) }),
        edge: automationRunsGraceEdge,
        publish: (view) => dependencies.publish({ scope, view }),
        failed: (failure) => dependencies.publish({ scope, view: { failure } }),
      });
  }
}
