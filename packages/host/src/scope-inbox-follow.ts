import { AGENT_CALL_FAILURE, type INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import {
  inboxOfLiveRows,
  LIVE_SIGNED_OUT,
  type ScopeInboxLiveAnswer,
  scopeInboxLiveRowsSchema,
} from "@luke/features/live-wire";
import { Data, Effect, Equal, RcMap, type Scope, Stream, SubscriptionRef } from "effect";
import {
  type AppHolderInbox,
  type AppHolderInboxes,
  NO_HOLDER_INBOXES,
  UNREAD,
} from "./app-state.js";
import { type InboxReads, itemsRead } from "./inbox-collections.js";
import { type HeldReads, heldReads } from "./live-collection.js";
import { followTakingRows, LIVE_STATE, restarting, type TxWait } from "./live-follow.js";

/**
 * scope-inbox-follow.ts -- a plan's inbox, or one agent's, followed for main over the service's held poll while a window holds it, and told whole on the app state as it changes.
 *
 * The host follows the scope's live read (`live-follow.ts`) the first time
 * the scope is held, keeps its items in a collection that stands among the
 * reads an inbox write reaches (`inbox-collections.ts`), takes each
 * answer's rows as its poll answers, and tells the items as they stand
 * after each answer and each write drawn over them. One the account does
 * not reach is not found, as the held read said. A window holds the scopes
 * it chose (`holderInboxes`, on `live-collection.ts`'s `heldReads`), and
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
  /** The reads an inbox write reaches, among which each scope's stands while it is followed. */
  readonly reads: InboxReads;
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
        const read = yield* itemsRead(dependencies.reads);
        let wait: TxWait | undefined;
        let answered = false;
        // Note that nothing is told before the read first answers, since a write drawn on no items shows nothing of the scope.
        const drawn = Effect.suspend(() =>
          answered
            ? SubscriptionRef.set(inbox, {
                kind: LIVE_STATE.STANDING,
                inbox: { items: read.inOrder() },
              })
            : Effect.void,
        );
        yield* dependencies.reads.stand({
          shown: read.shown,
          take: read.take,
          txWait: () => wait,
          drawn: () => drawn,
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

/** The scopes the windows hold, and what the host does for them. */
export interface HolderInboxes {
  /** Holds `scope`'s read for the caller's scope, following it unless it stands. */
  readonly hold: HeldReads<InboxScopeKey>["hold"];
  /** Reads `scope` again at once, as Try again asks, telling nothing of it meanwhile where it had failed. */
  readonly retry: (scope: InboxScopeKey) => Effect.Effect<void>;
  /** Follows every held scope anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every follow go and tells no scope held: the session ended. */
  readonly end: Effect.Effect<void>;
}

/**
 * The held lifetime over every scope's follow, told whole on one slice:
 * each scope's read as its follow last told it, kept where a later read
 * does not answer, and failed where it never answered; one let go for good
 * is told no more. Behind a closed gate a held scope is followed only once
 * the gate opens (`open`).
 */
export function holderInboxes(
  inboxes: ScopeInboxes,
  dependencies: {
    /** Whether the account gate stands open, so a follow may read. */
    readonly gate: () => boolean;
    readonly tell: (held: AppHolderInboxes) => Effect.Effect<void>;
  },
): Effect.Effect<HolderInboxes, never, Scope.Scope> {
  return Effect.gen(function* () {
    let held: AppHolderInboxes = NO_HOLDER_INBOXES;
    const readOf = (scope: InboxScopeKey): AppHolderInbox | undefined => held[scope.kind][scope.id];
    const set = (scope: InboxScopeKey, read: AppHolderInbox | undefined) => {
      const ofKind = { ...held[scope.kind] };
      if (read === undefined) Reflect.deleteProperty(ofKind, scope.id);
      else ofKind[scope.id] = read;
      held = { ...held, [scope.kind]: ofKind };
      return dependencies.tell(held);
    };
    const tellScope = (scope: InboxScopeKey) => (told: Told) =>
      Effect.suspend(() => {
        if (!("failure" in told)) return set(scope, { rows: told.items });
        // Note that a read that stops answering keeps its rows, since its next answer brings them up to date.
        return readOf(scope)?.rows === undefined ? set(scope, { failed: true }) : Effect.void;
      });
    const follow = (scope: InboxScopeKey) =>
      Effect.suspend(() =>
        dependencies.gate() ? followInbox(inboxes, scope, tellScope(scope)) : Effect.void,
      );
    const reads = yield* heldReads<InboxScopeKey>(
      follow,
      (scope) => set(scope, undefined),
      Effect.suspend(() => {
        held = NO_HOLDER_INBOXES;
        return dependencies.tell(held);
      }),
    );
    return {
      hold: reads.hold,
      retry: (scope) =>
        Effect.andThen(
          readOf(scope)?.failed === true ? set(scope, UNREAD) : Effect.void,
          reads.reopen(scope),
        ),
      open: reads.reopenHeld,
      end: reads.end,
    };
  });
}
