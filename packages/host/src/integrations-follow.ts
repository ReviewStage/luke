import {
  type IntegrationLiveRow,
  type IntegrationStatusesAnswer,
  type IntegrationStatusesLiveAnswer,
  integrationLiveRowsOf,
  integrationStatusesOfLive,
} from "@repo/features/integration-live";
import type { IntegrationStatusView } from "@repo/features/integration-view";
import { INTEGRATION_STATUS, type IntegrationStatus } from "@repo/features/integration-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { Duration, Effect, Option, Queue, Schedule, type Scope, Stream } from "effect";
import { type AppIntegrations, NO_KEYS_HELD } from "./app-state.js";
import {
  answeredCollection,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
  rowsOf,
} from "./live-collection.js";
import { pushLive } from "./live-push.js";
import type { WindowFocus } from "./window-focus.js";

/**
 * integrations-follow.ts -- where every one of the account's integrations stands, held for the windows that draw one: its rows followed over the service's held poll into a collection by their ids, GitHub's standing asked beside them, and a sign-in that stands pending settled while it does.
 *
 * The host follows the account's integration rows while any window holds
 * them and a while after (`heldSlice`), so a sign-in the developer finishes
 * in the browser, which the service's callback completes, draws on every
 * open surface within the service's coalesce window, with no focus. The
 * providers the account is offered, and those that take several accounts,
 * ride beside the rows on every answer, since no statement reads them.
 * GitHub's standing comes from the account's GitHub sign-in rather than a
 * row, so it is asked beside the rows: as the follow starts, again as a
 * window comes forward, and again once a GitHub connect or disconnect
 * answers (`githubMoved`). Nothing is drawn until both have answered, and a
 * GitHub ask that fails keeps the standing it last answered.
 *
 * A browser returned anywhere but the service's own callback completes
 * nothing, so while a row stands pending the host asks the service to
 * settle every sign-in under way, every `INTEGRATION_SETTLE_EVERY`, and asks
 * nothing while none does; what it settles arrives on the rows. A settle
 * also labels a connected account that carries no label, from its grant or
 * its provider, so one is asked once for each such row a follow meets.
 */

/**
 * How often a sign-in that stands pending is settled. Note that each settle
 * asks Connect for a fresh token of every account signing in, whose rate
 * limit Connect does not document, so this stays well apart; a sign-in
 * returned to the service's own callback completes at once regardless.
 */
export const INTEGRATION_SETTLE_EVERY = Duration.seconds(10);

/** A read the service did not answer, as the client and the gate tell it. */
interface IntegrationsUnanswered {
  readonly failure: string;
}

export interface IntegrationsFollowDependencies {
  /** The account's integration rows sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<IntegrationStatusesLiveAnswer | IntegrationsUnanswered>;
  /** Where GitHub stands for the account signed in, or why there is no answer. */
  readonly github: Effect.Effect<IntegrationStatusView>;
  /** Every sign-in under way settled by the service, what it settles written to the rows. */
  readonly settle: Effect.Effect<void>;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The windows coming forward, on each of which GitHub's standing is asked again. */
  readonly focus: WindowFocus;
  readonly tell: (held: AppIntegrations) => void;
}

/** The account's integrations the windows hold, by the account, and what the host does for them. */
export interface HeldIntegrations extends HeldSlice<string> {
  /** GitHub's standing asked again on every follow, as a GitHub connect or disconnect that answered asks. */
  readonly githubMoved: Effect.Effect<void>;
}

/** The providers that ride beside the rows on an answer. */
interface Beside {
  readonly offered: readonly string[];
  readonly multiple: readonly string[];
}

/** Whether two answers' providers beside the rows say the same. */
function sameBeside(held: Beside | undefined, next: Beside): boolean {
  return (
    held !== undefined &&
    held.offered.join() === next.offered.join() &&
    held.multiple.join() === next.multiple.join()
  );
}

/**
 * Follows `userId`'s integrations until let go, each change told through
 * `answers`: the rows as the read last answered them, drawn with the
 * providers beside them and GitHub's standing once both have answered;
 * GitHub's asked again on each of `githubAgain`'s asks and each window
 * coming forward; and the service asked to settle while a row stands
 * pending, and once for each connected row it meets with no label.
 */
function followIntegrations(
  dependencies: IntegrationsFollowDependencies,
  userId: string,
  answers: HeldAnswers<IntegrationStatusesAnswer>,
  githubAgain: Queue.Queue<void>,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const connections = yield* answeredCollection<IntegrationLiveRow, string>({
      getKey: (row) => row.id,
    });
    const pending = yield* Queue.sliding<boolean>(1);
    const unlabeled = yield* Queue.sliding<void>(1);
    /** The connected rows with no label a settle was asked for, by their ids, so each is asked once. */
    const labelAsked = new Set<string>();
    let beside: Beside | undefined;
    let github: IntegrationStatus | undefined;
    let taken = false;
    const draw = () => {
      if (!taken || beside === undefined || github === undefined) return;
      const rows = rowsOf(connections.collection);
      answers.answered(integrationStatusesOfLive(rows, beside.offered, beside.multiple, github));
      Queue.offerUnsafe(
        pending,
        rows.some((row) => row.status === INTEGRATION_STATUS.PENDING),
      );
      const unnamed = rows.filter(
        (row) =>
          row.status === INTEGRATION_STATUS.CONNECTED &&
          row.label === null &&
          !labelAsked.has(row.id),
      );
      for (const row of unnamed) labelAsked.add(row.id);
      if (unnamed.length > 0) Queue.offerUnsafe(unlabeled, undefined);
    };
    const askGithub = Effect.map(dependencies.github, (answer) => {
      if ("status" in answer) {
        github = answer.status;
        draw();
      } else if (github === undefined) answers.unanswered();
    });
    yield* Effect.forkScoped(
      Stream.make(undefined).pipe(
        Stream.concat(Stream.merge(Stream.fromQueue(githubAgain), yield* dependencies.focus.heard)),
        Stream.runForEach(() => askGithub),
      ),
    );
    // Note that the schedule starts anew only as the rows turn pending, so a draw that changes nothing of it keeps its spacing.
    const whilePending = Stream.fromQueue(pending).pipe(
      Stream.changes,
      Stream.switchMap((standing) =>
        standing ? Stream.fromSchedule(Schedule.spaced(INTEGRATION_SETTLE_EVERY)) : Stream.empty,
      ),
    );
    yield* Effect.forkScoped(
      Stream.merge(whilePending, Stream.fromQueue(unlabeled)).pipe(
        Stream.runForEach(() => dependencies.settle),
      ),
    );
    yield* pushLive({
      seal: (poll, after) =>
        dependencies.gate()
          ? Effect.map(dependencies.seal(userId, poll, after), (sealed) => {
              if ("failure" in sealed) {
                return {
                  failure: sealed.failure,
                  gone: sealed.failure === LIVE_SIGNED_OUT.failure,
                };
              }
              const next = { offered: sealed.offered, multiple: sealed.multiple };
              if (!sameBeside(beside, next)) {
                beside = next;
                draw();
              }
              return sealed;
            })
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      decode: (parts) => Option.some(integrationLiveRowsOf(parts.connections)),
      publish: (rows) =>
        Effect.sync(() => {
          if (rows === undefined) return answers.unanswered();
          connections.answer(rows);
          taken = true;
          draw();
        }),
    });
  });
}

/**
 * The held lifetime over the account's integrations (`heldSlice`), keyed by
 * the account, told whole on their slice: as the follow last told them,
 * kept where a later read does not answer, and failed where none ever
 * answered. A read refused as signed out, the session another account's
 * now, is followed no longer until a window holds it anew.
 */
export function heldIntegrations(
  dependencies: IntegrationsFollowDependencies,
): Effect.Effect<HeldIntegrations, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each standing follow's GitHub asks, which a GitHub connect or disconnect asks on. */
    const githubAsks = new Set<Queue.Queue<void>>();
    const slice = yield* heldSlice<typeof LIVE_READ.INTEGRATIONS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate: dependencies.gate,
      follow: (userId, answers) =>
        Effect.scoped(
          Effect.gen(function* () {
            const githubAgain = yield* Queue.sliding<void>(1);
            githubAsks.add(githubAgain);
            yield* Effect.addFinalizer(() => Effect.sync(() => githubAsks.delete(githubAgain)));
            yield* followIntegrations(dependencies, userId, answers, githubAgain);
          }),
        ),
      tell: dependencies.tell,
    });
    return {
      ...slice,
      githubMoved: Effect.sync(() => {
        for (const asks of githubAsks) Queue.offerUnsafe(asks, undefined);
      }),
    };
  });
}
