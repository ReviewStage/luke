import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxChanged,
  type INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import {
  inboxOfLiveRows,
  LIVE_SIGNED_OUT,
  type ScopeInboxLiveAnswer,
  scopeInboxLiveRowsSchema,
} from "@luke/features/live-wire";
import { Data, Duration, Effect, Equal, RcMap, type Scope, Stream, SubscriptionRef } from "effect";
import { type InboxReads, itemsRead } from "./inbox-collections.js";
import { followTakingRows, LIVE_STATE, restarting, type TxWait } from "./live-follow.js";

/**
 * scope-inbox-follow.ts -- a plan's inbox, or one agent's, followed for main over the service's held poll while it is followed, and told whole as it changes.
 *
 * The host follows the scope's live read (`live-follow.ts`) the first time
 * the scope is followed, keeps its items in a collection that stands among
 * the reads an inbox write reaches (`inbox-collections.ts`), takes each
 * answer's rows as its poll answers, tells the items as they stand after
 * each answer and each write drawn over them, and lets the follow go a
 * while after the last reader let go of it. One the account does not reach
 * is not found, as the held read said.
 */

/** How long a follow no reader holds is kept, so a window coming back finds it standing. */
const IDLE = Duration.seconds(30);

/** Which inbox: one plan's, or one agent's, by its id. */
export class InboxScopeKey extends Data.Class<{
  readonly kind: (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];
  readonly id: string;
}> {}

/** Where a scope's items stand as the follow last delivered them, a standing write's among them. */
interface LiveInbox {
  readonly items: readonly InboxItem[];
}

/** What a scope's read is answered from. */
type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly inbox: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.REFUSED; readonly failure: CodingAgentCallFailure };

/** Why a scope's read is refused: not found, or unanswered. */
type CodingAgentCallFailure =
  | typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND
  | typeof CODING_AGENT_CALL_FAILURE.UNANSWERED;

/** A follow before its first rows, with them, or stopped for good. */
type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly inbox: LiveInbox }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

export interface ScopeInboxDependencies {
  /** The scope's read for the account named, its rows inline, held past `after` where it names one; not found, signed out, or a failure where the service answered none. */
  readonly seal: (
    scope: InboxScopeKey,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<ScopeInboxLiveAnswer | { readonly failure: string }>;
  /** The account signed in now, which a follow is read for from its first read on; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** The reads an inbox write reaches, among which each scope's stands while it is followed. */
  readonly reads: InboxReads;
}

/** The follows the windows' reads share, each held while read and a while after. */
export type ScopeInboxes = RcMap.RcMap<InboxScopeKey, Standing>;

/** The map a composer holds for as long as it stands. */
export function scopeInboxes(
  dependencies: ScopeInboxDependencies,
): Effect.Effect<ScopeInboxes, never, Scope.Scope> {
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (scope: InboxScopeKey) =>
      Effect.gen(function* () {
        // The account the follow starts for, which every renewal and poll names, so one under another's session is refused as signed out.
        const userId = dependencies.accountId();
        const seal = (poll: boolean, after?: string) =>
          userId === undefined
            ? Effect.succeed(LIVE_SIGNED_OUT)
            : dependencies.seal(scope, poll, userId, after);
        const first = yield* seal(false);
        if ("failure" in first) {
          const failure =
            first.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
              ? CODING_AGENT_CALL_FAILURE.NOT_FOUND
              : CODING_AGENT_CALL_FAILURE.UNANSWERED;
          return { kind: LIVE_STATE.REFUSED, failure } as const;
        }
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        const read = yield* itemsRead();
        let wait: TxWait | undefined;
        let answered = false;
        // Note that nothing is told before the read first answers, since a write drawn on no items shows nothing of the scope.
        const drawn = Effect.suspend(() =>
          answered
            ? SubscriptionRef.set(inbox, {
                kind: LIVE_STATE.STANDING,
                inbox: { items: read.shown() },
              })
            : Effect.void,
        );
        yield* dependencies.reads.stand({
          draw: read.draw,
          take: read.take,
          txWait: () => wait,
          drawn,
          accountWide: false,
        });
        const taken = followTakingRows(
          {
            poll: (after) => seal(true, after),
            onTxWait: (handed) => {
              wait = handed;
            },
          },
          first,
          scopeInboxLiveRowsSchema,
          (rows) =>
            Effect.suspend(() => {
              read.items.answer(inboxOfLiveRows(rows));
              answered = true;
              return drawn;
            }),
        );
        yield* Effect.forkScoped(
          taken.pipe(Effect.catch(() => SubscriptionRef.set(inbox, { kind: LIVE_STATE.BROKEN }))),
        );
        return { kind: LIVE_STATE.LIVE, inbox } as const;
      }),
  });
}

/** A followed inbox as the window is told it: its items whole, or why there are none. */
type Told = CodingAgentInboxChanged["inbox"];

/**
 * The scope's inbox followed until interrupted, each change told whole from
 * its follow once its first rows land, the same follow the reads share. One
 * the account does not reach is told not found, which ends the follow. A
 * read the service did not answer is told unanswered, and it, or a follow
 * that stopped, is let go and read again after `LIVE_RESTART`.
 */
export function followInbox(
  inboxes: ScopeInboxes,
  scope: InboxScopeKey,
  tell: (inbox: Told) => Effect.Effect<void>,
): Effect.Effect<void> {
  const attempt: Effect.Effect<boolean> = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, scope);
      if (standing.kind === LIVE_STATE.REFUSED) {
        yield* tell({ failure: standing.failure });
        return standing.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND;
      }
      // Note that a delivery that moved nothing is told nobody, every item compared whole, its thread's messages and files among it.
      yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.takeWhile((state) => state.kind !== LIVE_STATE.BROKEN),
        Stream.filter((state) => state.kind === LIVE_STATE.STANDING),
        Stream.map((state) => state.inbox),
        Stream.changesWith((one, other) => Equal.equals(one.items, other.items)),
        Stream.runForEach((inbox) => tell({ items: inbox.items })),
      );
      return false;
    }),
  );
  // Note that a follow that goes on is let go before the wait, so the next run reads it afresh.
  return restarting(
    Effect.flatMap(attempt, (ended) =>
      ended ? Effect.succeed(false) : Effect.as(RcMap.invalidate(inboxes, scope), true),
    ),
  );
}
