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
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Duration, Effect, Queue, Schedule, Schema, type Scope, Stream } from "effect";
import { type AppIntegrations, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import { confirmWrite, followTakingRows, restarting, type TxWait } from "./live-follow.js";
import type { WindowFocus } from "./window-focus.js";

const INTEGRATION = fieldKind((row: IntegrationLiveRow) => row.id);

export const INTEGRATION_SETTLE_EVERY = Duration.seconds(10);

interface IntegrationsUnanswered {
  readonly failure: string;
}

export interface IntegrationsFollowDependencies {
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<IntegrationStatusesLiveAnswer | IntegrationsUnanswered>;
  readonly github: Effect.Effect<IntegrationStatusView>;
  readonly settle: Effect.Effect<void>;
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  readonly pool: EntityPool;
  readonly tell: (held: AppIntegrations) => void;
}

export interface HeldIntegrations extends HeldSlice<string> {
  readonly githubMoved: Effect.Effect<void>;
  readonly confirmed: (
    userId: string,
    connection: string,
    txid: string | undefined,
    moves: (row: IntegrationLiveRow | undefined) => boolean,
  ) => Effect.Effect<void>;
  readonly synced: (userId: string, connection: string) => IntegrationLiveRow | undefined;
}

interface Followed {
  readonly rows: () => readonly IntegrationLiveRow[];
  readonly synced: () => readonly IntegrationLiveRow[];
  readonly txWait: () => TxWait | undefined;
  readonly github: Effect.Effect<void>;
}

interface Beside {
  readonly offered: readonly string[];
  readonly multiple: readonly string[];
}

function sameBeside(held: Beside | undefined, next: Beside): boolean {
  return (
    held !== undefined &&
    held.offered.join() === next.offered.join() &&
    held.multiple.join() === next.multiple.join()
  );
}

const LiveRowsSchema = Schema.Struct({ connections: Schema.Array(Schema.Unknown) });

function followIntegrations(
  dependencies: IntegrationsFollowDependencies,
  userId: string,
  answers: HeldAnswers<IntegrationStatusesAnswer>,
  followed: (follow: Followed) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const pending = yield* Queue.sliding<boolean>(1);
    const unlabeled = yield* Queue.sliding<void>(1);
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

export function heldIntegrations(
  dependencies: IntegrationsFollowDependencies,
): Effect.Effect<HeldIntegrations, never, Scope.Scope> {
  return Effect.gen(function* () {
    const follows = new Map<string, Followed>();
    const slice = yield* heldSlice<typeof LIVE_READ.INTEGRATIONS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate: dependencies.gate,
      follow: (userId, answers) =>
        Effect.scoped(
          Effect.gen(function* () {
            let standing: Followed | undefined;
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

export interface IntegrationRename extends IntegrationRenameParams {
  readonly id: string | undefined;
}

export function integrationRename(
  send: (rename: IntegrationRename) => Effect.Effect<IntegrationAccountView>,
  carries: (rename: IntegrationRename, label: string | undefined) => boolean,
): WriteDeclaration<
  IntegrationLiveRow,
  FieldChange<IntegrationLiveRow>,
  IntegrationRename,
  WireValue
> {
  return {
    kind: INTEGRATION,
    keys: (rename) => (rename.id === undefined ? [] : [rename.id]),
    change: (rename) => () => ({ label: rename.label }),
    send: (rename) =>
      Effect.map(send(rename), (answer) => {
        if ("failure" in answer) return { refused: carried<IntegrationAccountView>(answer) };
        const kept = answer.account.label;
        return {
          answer: carried<IntegrationAccountView>(answer),
          txid: carries(rename, kept) ? undefined : answer.txid,
          ...(kept === undefined ? undefined : { standsAs: () => ({ label: kept }) }),
        };
      }),
  };
}
