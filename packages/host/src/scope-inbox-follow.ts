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

export class InboxScopeKey extends Data.Class<{
  readonly kind: (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];
  readonly id: string;
}> {}

interface LiveInbox {
  readonly items: readonly InboxItem[];
}

type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly inbox: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.REFUSED; readonly failure: AgentCallFailure };

type AgentCallFailure = typeof AGENT_CALL_FAILURE.NOT_FOUND | typeof AGENT_CALL_FAILURE.UNANSWERED;

type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly inbox: LiveInbox }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

export interface ScopeInboxDependencies {
  readonly seal: (
    scope: InboxScopeKey,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<ScopeInboxLiveAnswer | { readonly failure: string }>;
  readonly accountId: () => string | undefined;
  readonly pool: EntityPool;
}

export type ScopeInboxes = RcMap.RcMap<InboxScopeKey, Standing>;

export function scopeInboxes(
  dependencies: ScopeInboxDependencies,
): Effect.Effect<ScopeInboxes, never, Scope.Scope> {
  return RcMap.make({
    lookup: (scope: InboxScopeKey) =>
      Effect.gen(function* () {
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

type Told = { readonly items: readonly InboxItem[] } | { readonly failure: AgentCallFailure };

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
  return restarting(
    Effect.flatMap(attempt, (ended) =>
      ended ? Effect.succeed(false) : Effect.as(RcMap.invalidate(inboxes, scope), true),
    ),
  );
}

export function holderInboxes(
  inboxes: ScopeInboxes,
  dependencies: {
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
          "failure" in told ? answers.unanswered() : answers.answered(told.items),
        ),
      ),
  });
}
