import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowsSchema,
  accountInboxOfLiveRows,
  nextFailedRunExpiry,
} from "@luke/features/live-wire";
import {
  Clock,
  Duration,
  Effect,
  Option,
  RcMap,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { InboxTxWaits } from "./inbox-tx-waits.js";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime and told to main each time it moves.
 *
 * The host subscribes to the account's sealed statements (`live-follow.ts`,
 * which polls them while Realtime fails or is off) once main follows the
 * account inbox, builds the answer the held read answered from each delivery
 * (`accountInboxOfLiveRows`), and tells main each one, which its notices, the
 * Dock badge, and the Inbox tab observe. A failed run ages out of the last
 * week with no row moving, so the answer is built again as it does. A seal
 * refused as signed out ends the subscription, which is sealed again after
 * `LIVE_RESTART`. The sealed statements stay here, where the account's
 * own bearer is; only the answer built from the rows leaves.
 */

/** How long a subscription no follow holds is kept, so a follow started again soon finds it standing. */
const IDLE = Duration.seconds(30);
/** How long a subscription that stopped, or a seal refused, waits before it is sealed again. */
const LIVE_RESTART = Duration.seconds(5);

/** A seal the service did not answer, `gone` where it never will again. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

/** A subscription before its first rows, with the answer they make, or stopped for good. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly answer: AccountInboxAnswer }
  | { readonly kind: "broken" };

/** What an account's read is answered from: its subscription, or that the service sealed none. */
type Standing =
  | { readonly kind: "live"; readonly inbox: SubscriptionRef.SubscriptionRef<LiveState> }
  | { readonly kind: "broken" };

export interface AccountInboxDependencies {
  /** The account's read sealed for following for the account named, or with `poll` its rows inline; signed out, or a failure where the service sealed none. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountInboxLiveAnswer | SealFailure>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** Where the account inbox's wait for a write's transaction stands while it is subscribed, which the inbox's writes wait on. */
  readonly txWaits: InboxTxWaits;
}

/** Each account's subscription, by its id, held while main reads it and a while after. */
export type AccountInboxes = RcMap.RcMap<string, Standing>;

/** The answer the rows make now, and again each time a failed run they carry ages out, until the rows move. */
function answersOf(rows: AccountInboxLiveRows): Stream.Stream<AccountInboxAnswer> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(accountInboxOfLiveRows(rows, at));
      const expiry = nextFailedRunExpiry(rows.failedRuns, at);
      if (expiry === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(expiry - at + 1)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => answersOf(rows)),
      );
    }),
  );
}

/** The map a composer holds for as long as it stands. */
export function accountInboxes(
  dependencies: AccountInboxDependencies,
): Effect.Effect<AccountInboxes, never, Scope.Scope> {
  const decode = Schema.decodeUnknownOption(accountInboxLiveRowsSchema);
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (userId: string) =>
      Effect.gen(function* () {
        const first = yield* dependencies.seal(userId, false);
        if ("failure" in first) return { kind: "broken" } as const;
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        const rows = liveRows(
          {
            openLive: dependencies.openLive,
            reseal: () => dependencies.seal(userId, false),
            poll: (after) => dependencies.seal(userId, true, after),
            now: dependencies.now,
            onTxWait: dependencies.txWaits.hook(),
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
        yield* Effect.forkScoped(
          Stream.runForEach(Stream.switchMap(rows, answersOf), (answer) =>
            SubscriptionRef.set(inbox, { kind: "standing", answer }),
          ).pipe(
            Effect.catch(() => Effect.void),
            Effect.ensuring(SubscriptionRef.set(inbox, { kind: "broken" })),
          ),
        );
        return { kind: "live", inbox } as const;
      }),
  });
}

/**
 * What waits across the account for `userId`, told whole each time it moves,
 * until the fiber is let go. A seal the service refused, or a subscription
 * that stopped, is let go and sealed again after `LIVE_RESTART`, for whoever
 * the caller follows then.
 */
export function followAccountInbox(
  inboxes: AccountInboxes,
  userId: string,
  tell: (answer: AccountInboxAnswer) => Effect.Effect<void>,
): Effect.Effect<never> {
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, userId);
      if (standing.kind === "broken") return;
      yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.takeWhile((state) => state.kind !== "broken"),
        Stream.filter((state) => state.kind === "standing"),
        Stream.runForEach((state) => tell(state.answer)),
      );
    }),
  );
  return Effect.forever(
    attempt.pipe(
      Effect.andThen(RcMap.invalidate(inboxes, userId)),
      Effect.andThen(Effect.sleep(LIVE_RESTART)),
    ),
  );
}
