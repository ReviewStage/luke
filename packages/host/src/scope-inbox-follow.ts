import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerView,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import {
  inboxOfLiveRows,
  type ScopeInboxLiveAnswer,
  scopeInboxLiveRowsSchema,
} from "@luke/features/live-wire";
import {
  Duration,
  Effect,
  Option,
  RcMap,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { Hex } from "effect/encoding";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * scope-inbox-follow.ts -- a plan's inbox, or one agent's, read by the window as before but answered from a Neon Realtime subscription the host holds while the window reads it.
 *
 * The window still asks with the cursor it was last answered, and is
 * answered as soon as the inbox moves past it, or with the inbox unchanged
 * once the hold ends, as the service's held read answered it. What changed
 * is where the answer comes from: the host subscribes to the scope's sealed
 * statements (`live-follow.ts`) the first time a window asks, keeps the
 * items as each change lands, and lets the subscription go a while after
 * the last read let go of it. Nothing asks the service on a clock. A scope
 * the account does not reach is not found, as the held read said; a seal
 * the service did not answer, or a subscription that stopped, is answered
 * unanswered and let go, so the window's next read subscribes again.
 */

/** How long a read is held while nothing moved past its cursor, as the service held it. */
const HOLD = Duration.seconds(20);
/** How long a subscription no read holds is kept, so the window's next read finds it standing. */
const IDLE = Duration.seconds(30);

/** Which inbox: one plan's, or one agent's. */
export type InboxScopeKey = `plan:${string}` | `agent:${string}`;

/** Where a scope's items stand as the subscription last delivered them, and the cursor they digest to. */
interface LiveInbox {
  readonly items: readonly InboxItem[];
  readonly cursor: string;
}

/** What a scope's read is answered from. */
type Standing =
  | { readonly kind: "live"; readonly inbox: SubscriptionRef.SubscriptionRef<LiveState> }
  | { readonly kind: "refused"; readonly failure: CodingAgentCallFailure };

/** Why a scope's read is refused: not found, or unanswered. */
type CodingAgentCallFailure =
  | typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND
  | typeof CODING_AGENT_CALL_FAILURE.UNANSWERED;

/** A subscription before its first rows, with them, or stopped for good. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly inbox: LiveInbox }
  | { readonly kind: "broken" };

/**
 * A digest of where every item stands, and whether it is unread for the
 * reader: any change to any of them, or the reader marking one read or
 * unread, moves it, as the service's stamps do. Note that it is Web Crypto's
 * SHA-256, since the host loads where no `node:` module does.
 */
function cursorOf(items: readonly InboxItem[]): Effect.Effect<string> {
  const standing = items
    .map(
      (item) => [item.id, item.revision, item.status, item.updatedAt, item.unread ?? null] as const,
    )
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(standing))),
    ),
    (digest) => `live-${Hex.encode(new Uint8Array(digest)).slice(0, 32)}`,
  );
}

export interface ScopeInboxDependencies {
  /** The scope sealed for following; not found, or a failure where the service sealed none. */
  readonly seal: (
    scope: InboxScopeKey,
  ) => Effect.Effect<ScopeInboxLiveAnswer | { readonly failure: string }>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/** The subscriptions the windows' reads share, each held while read and a while after. */
export type ScopeInboxes = RcMap.RcMap<InboxScopeKey, Standing>;

/** The map a composer holds for as long as it stands. */
export function scopeInboxes(
  dependencies: ScopeInboxDependencies,
): Effect.Effect<ScopeInboxes, never, Scope.Scope> {
  const decode = Schema.decodeUnknownOption(scopeInboxLiveRowsSchema);
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (scope: InboxScopeKey) =>
      Effect.gen(function* () {
        const first = yield* dependencies.seal(scope);
        if ("failure" in first) {
          const failure =
            first.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
              ? CODING_AGENT_CALL_FAILURE.NOT_FOUND
              : CODING_AGENT_CALL_FAILURE.UNANSWERED;
          return { kind: "refused", failure } as const;
        }
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        const rows = liveRows(
          {
            openLive: dependencies.openLive,
            reseal: () => dependencies.seal(scope),
            now: dependencies.now,
          },
          first,
        );
        yield* Effect.forkScoped(
          Stream.runForEach(rows, (read) =>
            Option.match(decode(read), {
              onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
              onSome: (decoded) => {
                const items = inboxOfLiveRows(decoded);
                return Effect.flatMap(cursorOf(items), (cursor) =>
                  SubscriptionRef.set(inbox, { kind: "standing", inbox: { items, cursor } }),
                );
              },
            }),
          ).pipe(Effect.catch(() => SubscriptionRef.set(inbox, { kind: "broken" }))),
        );
        return { kind: "live", inbox } as const;
      }),
  });
}

/**
 * The scope's inbox past the reader's cursor: at once where it moved, or
 * once it does within the hold, or unchanged once the hold ends. A scope
 * refused, or whose subscription stopped or had no rows within the hold,
 * is answered why and let go, so the next read subscribes again.
 */
export function inboxPast(
  inboxes: ScopeInboxes,
  scope: InboxScopeKey,
  after: string,
): Effect.Effect<CodingAgentInboxAnswerView> {
  return Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, scope);
      if (standing.kind === "refused") {
        yield* RcMap.invalidate(inboxes, scope);
        return { failure: standing.failure };
      }
      const moved = yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.filter(
          (state) =>
            state.kind === "broken" || (state.kind === "standing" && state.inbox.cursor !== after),
        ),
        Stream.runHead,
        Effect.timeoutOption(HOLD),
        Effect.map(Option.flatten),
      );
      const state = Option.isSome(moved) ? moved.value : yield* SubscriptionRef.get(standing.inbox);
      if (state.kind === "standing")
        return { items: state.inbox.items, cursor: state.inbox.cursor };
      yield* RcMap.invalidate(inboxes, scope);
      return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
    }),
  );
}
