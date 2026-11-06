import { AGENT_CALL_FAILURE, type INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  inboxInOrder,
  inboxOfLiveRows,
  type LIVE_READ,
  LIVE_SIGNED_OUT,
  type ScopeInboxLiveAnswer,
  scopeInboxLiveRowsSchema,
} from "@repo/features/live-wire";
import type { EntityPool, HeldRows } from "@repo/sync";
import { Data, Effect, Equal, RcMap, type Scope, Stream, SubscriptionRef } from "effect";
import { type AppHolderInboxes, NO_HOLDER_INBOXES } from "./app-state.js";
import { INBOX_ITEM, type InboxChange } from "./inbox-collections.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_STATE,
  restarting,
  type TxWait,
} from "./live-follow.js";

/**
 * scope-inbox-follow.ts -- a plan's inbox, or one agent's, followed for main over the service's held poll while a window holds it, and told whole on the app state as it changes.
 *
 * The host follows the scope's live read (`live-follow.ts`) the first time
 * the scope is held, stands its items in the sync engine's pool
 * (`inbox-collections.ts`'s `INBOX_ITEM`), which every inbox write is drawn
 * over, takes each answer's rows as its poll answers, and tells the items
 * as they stand after each answer and each write drawn over them. One the account does
 * not reach is not found, as the held read said. A window holds the scopes
 * it chose (`holderInboxes`, on `live-collection.ts`'s `heldSlice`), and
 * the host keeps the few let go latest followed, so a window stepping back
 * to one draws it from where it stands; every held scope is told whole on
 * the one slice the windows draw (`LIVE_READ.HOLDER_INBOX`).
 */

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
  | { readonly kind: typeof LIVE_STATE.REFUSED; readonly failure: AgentCallFailure };

/** Why a scope's read is refused: not found, or unanswered. */
type AgentCallFailure = typeof AGENT_CALL_FAILURE.NOT_FOUND | typeof AGENT_CALL_FAILURE.UNANSWERED;

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
  /** The sync engine's pool, which each scope's items stand in while it is followed. */
  readonly pool: EntityPool;
}

/** The follows the windows' reads share, each held while read and a while after. */
export type ScopeInboxes = RcMap.RcMap<InboxScopeKey, Standing>;

/** The map a composer holds for as long as it stands. Note that a scope's follow goes with its last reader, since what keeps one standing for a window coming back is the held lifetime (`holderInboxes`). */
export function scopeInboxes(
  dependencies: ScopeInboxDependencies,
): Effect.Effect<ScopeInboxes, never, Scope.Scope> {
  return RcMap.make({
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
            first.failure === AGENT_CALL_FAILURE.NOT_FOUND
              ? AGENT_CALL_FAILURE.NOT_FOUND
              : AGENT_CALL_FAILURE.UNANSWERED;
          return { kind: LIVE_STATE.REFUSED, failure } as const;
        }
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        let wait: TxWait | undefined;
        let answered = false;
        // Note that nothing is told before the read first answers, since a write drawn on no items shows nothing of the scope.
        const drawn: Effect.Effect<void> = Effect.suspend(() =>
          answered
            ? SubscriptionRef.set(inbox, {
                kind: LIVE_STATE.STANDING,
                inbox: { items: inboxInOrder(items.rows()) },
              })
            : Effect.void,
        );
        const items: HeldRows<InboxItem, InboxChange> = yield* dependencies.pool.stand(INBOX_ITEM, {
          redraw: () => drawn,
          confirmation: () => {
            const handed = wait;
            return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
          },
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
            Effect.andThen(
              items.answer(inboxOfLiveRows(rows)),
              Effect.suspend(() => {
                answered = true;
                return drawn;
              }),
            ),
        );
        yield* Effect.forkScoped(
          taken.pipe(Effect.catch(() => SubscriptionRef.set(inbox, { kind: LIVE_STATE.BROKEN }))),
        );
        return { kind: LIVE_STATE.LIVE, inbox } as const;
      }),
  });
}

/** A followed inbox as its follow tells it: its items whole, or why there are none. */
type Told = { readonly items: readonly InboxItem[] } | { readonly failure: AgentCallFailure };

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
        return standing.failure === AGENT_CALL_FAILURE.NOT_FOUND;
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

/**
 * The held lifetime over every scope's follow (`heldSlice`), told whole on
 * the held inboxes' slice: each scope's read as its follow last told it,
 * kept where a later read does not answer, and failed where it never
 * answered; one let go for good is told no more. Note that a scope the
 * account does not reach is told holding no items rather than failed,
 * because the service answers the reader no item of a task or agent it
 * does not reach, and a failure would offer a Try again no read can answer.
 */
export function holderInboxes(
  inboxes: ScopeInboxes,
  dependencies: {
    /** Whether the account gate stands open, so a follow may read. */
    readonly gate: () => boolean;
    readonly tell: (held: AppHolderInboxes) => void;
  },
): Effect.Effect<HeldSlice<InboxScopeKey>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.HOLDER_INBOX, InboxScopeKey>({
    empty: NO_HOLDER_INBOXES,
    path: (scope) => [scope.kind, scope.id],
    gate: dependencies.gate,
    tell: dependencies.tell,
    follow: (scope, answers) =>
      followInbox(inboxes, scope, (told) =>
        Effect.sync(() =>
          !("failure" in told)
            ? answers.answered(told.items)
            : told.failure === AGENT_CALL_FAILURE.NOT_FOUND
              ? answers.answered([])
              : answers.unanswered(),
        ),
      ),
  });
}
