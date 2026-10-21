import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
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
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over Neon Realtime and answered to main's held read of it past a cursor.
 *
 * The host subscribes to the account's sealed statements (`live-follow.ts`,
 * which polls them while Realtime fails or is off) the first time main reads
 * the account inbox, builds the answer the held read answered from each
 * delivery (`accountInboxOfLiveRows`), and lets the subscription go a while
 * after the last read let go of it. A read past a cursor is held until the
 * answer moves, or `HOLD` passes, as the service held it, so main's notices,
 * the Dock badge, and the Inbox tab read it as they read the held route. A
 * failed run ages out of the last week with no row moving, so the answer is
 * built again as it does. A seal refused as signed out ends the follow, and
 * the read is answered unanswered; the next read seals it again for whoever
 * is signed in then. The sealed statements stay here, where the account's
 * own bearer is; only the answer built from the rows leaves.
 */

/** How long a subscription no read holds is kept, so main's next read finds it standing. */
const IDLE = Duration.seconds(30);
/** How long a read whose cursor is the answer's is held, as the service held the account's read. */
const HOLD = Duration.seconds(25);

/** A read answered with nothing to say, which main asks again later. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

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
 * What waits across the account for `userId`, past `after`: answered once
 * the answer's cursor is not `after`, or once the answer moves at all while
 * the read is held, or as it stands once `HOLD` passes, as the service's
 * held read answered. Unanswered where the service sealed nothing or the
 * subscription stopped, each let go so the next read seals it again, and
 * where nothing was delivered within the hold.
 */
export function accountInboxPast(
  inboxes: AccountInboxes,
  userId: string,
  after: string,
): Effect.Effect<AccountInboxAnswer | typeof UNANSWERED> {
  const read = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, userId);
      if (standing.kind === "broken") return standing;
      const moved = yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.filter((state) => state.kind !== "waiting"),
        Stream.zipWithIndex,
        // The first answer seen is the one standing as the read lands; any after it moved something.
        Stream.filter(
          ([state, seen]) => state.kind === "broken" || seen > 0 || state.answer.cursor !== after,
        ),
        Stream.runHead,
        Effect.timeoutOption(HOLD),
      );
      if (Option.isSome(moved) && Option.isSome(moved.value)) return moved.value.value[0];
      return yield* SubscriptionRef.get(standing.inbox);
    }),
  );
  return Effect.flatMap(read, (state): Effect.Effect<AccountInboxAnswer | typeof UNANSWERED> => {
    if (state.kind === "standing") return Effect.succeed(state.answer);
    if (state.kind === "waiting") return Effect.succeed(UNANSWERED);
    return Effect.as(RcMap.invalidate(inboxes, userId), UNANSWERED);
  });
}
