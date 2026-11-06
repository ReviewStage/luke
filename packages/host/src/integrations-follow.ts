import {
  type IntegrationLiveRow,
  type IntegrationStatusesAnswer,
  type IntegrationStatusesLiveAnswer,
  integrationLiveRowsOf,
  integrationStatusesOfLive,
} from "@repo/features/integration-live";
import type {
  IntegrationAccountView,
  IntegrationRenameParams,
  IntegrationStatusView,
} from "@repo/features/integration-view";
import {
  INTEGRATION_STATUS,
  type IntegrationStatus,
  integrationLabelUnread,
} from "@repo/features/integration-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "@repo/sync";
import { Duration, Effect, Queue, Schedule, Schema, type Scope, Stream } from "effect";
import { type AppIntegrations, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { confirmWrite, followTakingRows, restarting, type TxWait } from "./live-follow.js";
import type { WindowFocus } from "./window-focus.js";

/**
 * integrations-follow.ts -- where every one of the account's integrations stands, held for the windows that draw one: its rows followed over the service's held poll into the sync engine's pool by their ids, GitHub's standing asked beside them, a sign-in that stands pending settled while it does, a write confirmed once the rows carry it, and a rename drawn over its account the moment it is asked.
 *
 * The host follows the account's integration rows while any window holds
 * them and a while after (`heldSlice`), so a sign-in the developer finishes
 * in the browser, which the service's callback completes, draws on every
 * open surface within the service's coalesce window, with no focus. The
 * providers the account is offered, and those that take several accounts,
 * ride beside the rows on every answer, since no statement reads them.
 * GitHub's standing comes from the account's GitHub sign-in rather than a
 * row, so it is asked beside the rows: as the follow starts, again as a
 * window comes forward, and again once a GitHub disconnect answers
 * (`githubMoved`), which waits on it. Nothing is drawn until both have
 * answered, and a GitHub ask that fails keeps the standing it last answered.
 *
 * A browser returned anywhere but the service's own callback completes
 * nothing, so while a row stands pending the host asks the service to
 * settle every sign-in under way, every `INTEGRATION_SETTLE_EVERY`, and asks
 * nothing while none does; what it settles arrives on the rows. A settle
 * also names a connected account still to be named, from its grant or its
 * provider, under the service's own rule (`integrationLabelUnread`): one is
 * asked once for each such row a follow meets, and again as a window comes
 * forward, since a settle that could not read a name leaves its row as it
 * was.
 *
 * Each account is one row of the pool (`@repo/sync`), by its id, taken the
 * moment each poll answers, before the follow carries the answer's txids
 * on, so a write confirmed on the read (`confirmed`) finds the rows that
 * carry it already drawn. A rename is a write the pool draws over its
 * account at once (`integrationRename`), standing until the read carries
 * its transaction, and taken back where the service refused it.
 */

/** An integration account as the pool holds it, by its row's id, every write to it a change of its fields. */
const INTEGRATION = fieldKind((row: IntegrationLiveRow) => row.id);

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
  /** The sync engine's pool, which the held integrations stand in while they are followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppIntegrations) => void;
}

/** The account's integrations the windows hold, by the account, and what the host does for them. */
export interface HeldIntegrations extends HeldSlice<string> {
  /** GitHub's standing asked again on every follow, as a GitHub disconnect that answered asks; done once each ask has landed. */
  readonly githubMoved: Effect.Effect<void>;
  /**
   * A write to one of `userId`'s accounts, by its connection name, confirmed
   * once its transaction reaches the rows the windows hold, where `moves`
   * says it moves what those rows show of that account; at once where it
   * does not, where it wrote nothing, or where no window holds the rows.
   */
  readonly confirmed: (
    userId: string,
    connection: string,
    txid: string | undefined,
    moves: (row: IntegrationLiveRow | undefined) => boolean,
  ) => Effect.Effect<void>;
  /** `userId`'s account `connection` as the service last answered it, before any write drawn over it; none where no window holds the rows or they carry no such account. */
  readonly synced: (userId: string, connection: string) => IntegrationLiveRow | undefined;
}

/** One follow as a write to it is confirmed: the rows it holds, as drawn and as answered, its wait for a write's transaction where it hands one, and its ask of GitHub's standing. */
interface Followed {
  readonly rows: () => readonly IntegrationLiveRow[];
  readonly synced: () => readonly IntegrationLiveRow[];
  readonly txWait: () => TxWait | undefined;
  readonly github: Effect.Effect<void>;
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

/** The one statement's rows, each read alone later (`integrationLiveRowsOf`). */
const LiveRowsSchema = Schema.Struct({ connections: Schema.Array(Schema.Unknown) });

/**
 * Follows `userId`'s integrations until let go, each change told through
 * `answers`: the rows as the read last answered them, drawn with the
 * providers beside them and GitHub's standing once both have answered;
 * GitHub's asked again as each window comes forward, and as `followed`'s
 * own ask is run; and the service asked to settle while a row stands
 * pending, and once for each connected row it meets still to be named,
 * again as a window comes forward. A read
 * the service did not answer is followed again after `LIVE_RESTART`, and
 * one refused as signed out, the session another account's now, no more.
 */
function followIntegrations(
  dependencies: IntegrationsFollowDependencies,
  userId: string,
  answers: HeldAnswers<IntegrationStatusesAnswer>,
  followed: (follow: Followed) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const pending = yield* Queue.sliding<boolean>(1);
    const unlabeled = yield* Queue.sliding<void>(1);
    /** The connected rows still to be named a settle was asked for, by their ids, so each is asked once until a window comes forward. */
    const labelAsked = new Set<string>();
    let beside: Beside | undefined;
    let github: IntegrationStatus | undefined;
    let taken = false;
    let txWait: TxWait | undefined;
    const askLabels = () => {
      const unnamed = connections
        .rows()
        .filter(
          (row) =>
            row.status === INTEGRATION_STATUS.CONNECTED &&
            integrationLabelUnread(row.provider, row.label) &&
            !labelAsked.has(row.id),
        );
      for (const row of unnamed) labelAsked.add(row.id);
      if (unnamed.length > 0) Queue.offerUnsafe(unlabeled, undefined);
    };
    const draw = () => {
      if (!taken || beside === undefined || github === undefined) return;
      const rows = connections.rows();
      answers.answered(integrationStatusesOfLive(rows, beside.offered, beside.multiple, github));
      Queue.offerUnsafe(
        pending,
        rows.some((row) => row.status === INTEGRATION_STATUS.PENDING),
      );
      askLabels();
    };
    const connections: HeldRows<IntegrationLiveRow> = yield* dependencies.pool.stand(INTEGRATION, {
      redraw: () => Effect.sync(draw),
      confirmation: () => {
        const handed = txWait;
        return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
      },
    });
    const askGithub = Effect.map(dependencies.github, (answer) => {
      if ("status" in answer) {
        github = answer.status;
        draw();
      } else if (github === undefined) answers.unanswered();
    });
    followed({
      rows: () => connections.rows(),
      synced: () => connections.synced(),
      txWait: () => txWait,
      github: askGithub,
    });
    // Note that a window come forward asks again for every account still to be named, as the statuses read did on focus before the rows were followed.
    const askAgain = Effect.sync(() => {
      labelAsked.clear();
      if (taken) askLabels();
    });
    yield* Effect.forkScoped(
      Stream.make(undefined).pipe(
        Stream.concat(yield* dependencies.focus.heard),
        Stream.runForEach(() => Effect.andThen(askAgain, askGithub)),
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
    /** Whether the service refused the read for good, the session another account's now. */
    let gone = false;
    const sealed = (poll: boolean, after?: string) =>
      dependencies.gate()
        ? Effect.map(dependencies.seal(userId, poll, after), (answer) => {
            if ("failure" in answer) {
              gone ||= answer.failure === LIVE_SIGNED_OUT.failure;
              return { failure: answer.failure, gone };
            }
            const next = { offered: answer.offered, multiple: answer.multiple };
            if (!sameBeside(beside, next)) {
              beside = next;
              draw();
            }
            return answer;
          })
        : Effect.sync(() => {
            gone = true;
            return { ...LIVE_SIGNED_OUT, gone };
          });
    const take = (parts: typeof LiveRowsSchema.Type) =>
      Effect.andThen(
        connections.answer(integrationLiveRowsOf(parts.connections)),
        Effect.sync(() => {
          taken = true;
          draw();
        }),
      );
    yield* restarting(
      Effect.gen(function* () {
        const first = yield* sealed(false);
        if ("failure" in first) {
          answers.unanswered();
          return !gone;
        }
        yield* followTakingRows(
          {
            poll: (after) => sealed(true, after),
            onTxWait: (wait) => {
              txWait = wait;
            },
          },
          first,
          LiveRowsSchema,
          take,
        ).pipe(Effect.catch(() => Effect.void));
        return !gone;
      }),
    );
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
    /** Each standing follow as a write to it is confirmed, by the account. */
    const follows = new Map<string, Followed>();
    const slice = yield* heldSlice<typeof LIVE_READ.INTEGRATIONS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate: dependencies.gate,
      follow: (userId, answers) =>
        Effect.scoped(
          Effect.gen(function* () {
            let standing: Followed | undefined;
            // Note that a follow lets go only of its own entry, since one started over may stand first.
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                if (follows.get(userId) === standing) follows.delete(userId);
              }),
            );
            yield* followIntegrations(dependencies, userId, answers, (follow) => {
              standing = follow;
              follows.set(userId, follow);
            });
          }),
        ),
      tell: dependencies.tell,
    });
    return {
      ...slice,
      githubMoved: Effect.suspend(() =>
        Effect.forEach([...follows.values()], (follow) => follow.github, {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
      confirmed: (userId, connection, txid, moves) =>
        Effect.suspend(() => {
          const follow = follows.get(userId);
          if (follow === undefined || txid === undefined) return Effect.void;
          const row = follow.rows().find((each) => each.connection === connection);
          // Note that a write that moves nothing the rows show is never carried by an answer that moved, so it is not waited on.
          return moves(row) ? confirmWrite(follow.txWait(), txid) : Effect.void;
        }),
      synced: (userId, connection) =>
        follows
          .get(userId)
          ?.synced()
          .find((each) => each.connection === connection),
    };
  });
}

/** A rename as the pool draws it: the account and its label, and the id of the row the windows hold for it, where they hold one. */
export interface IntegrationRename extends IntegrationRenameParams {
  readonly id: string | undefined;
}

/**
 * An account renamed, its label drawn at once over every held read of it,
 * sent as `send` asks, and standing from the answer on as the label the
 * service kept, which trims it. Note that a rename the rows already carry
 * (`carries`) is never answered by a read that moved, so it settles on its
 * own answer rather than waiting on its transaction; a refusal puts the
 * label back.
 */
export function integrationRename(
  send: (rename: IntegrationRename) => Effect.Effect<IntegrationAccountView>,
  carries: (rename: IntegrationRename, label: string | undefined) => boolean,
): WriteDeclaration<
  IntegrationLiveRow,
  FieldChange<IntegrationLiveRow>,
  IntegrationRename,
  IntegrationAccountView
> {
  return {
    kind: INTEGRATION,
    keys: (rename) => (rename.id === undefined ? [] : [rename.id]),
    change: (rename) => () => ({ label: rename.label }),
    send: (rename) =>
      Effect.map(send(rename), (answer) => {
        if ("failure" in answer) return { refused: answer };
        const kept = answer.account.label;
        return {
          answer,
          txid: carries(rename, kept) ? undefined : answer.txid,
          ...(kept === undefined ? undefined : { standsAs: () => ({ label: kept }) }),
        };
      }),
  };
}
