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
import {
  Data,
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
import type { InboxTxWaits } from "./inbox-tx-waits.js";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * scope-inbox-follow.ts -- a plan's inbox, or one agent's, followed for main from a Neon Realtime subscription the host holds while it is followed, and told whole as it changes.
 *
 * The host subscribes to the scope's sealed statements (`live-follow.ts`)
 * the first time the scope is followed, keeps the items as each change
 * lands, tells each change, and lets the subscription go a while after the
 * last follow let go of it. Nothing asks the service on a clock. One the
 * account does not reach is not found, as the held read said.
 */

/** How long a subscription no follow holds is kept, so a window coming back finds it standing. */
const IDLE = Duration.seconds(30);
/** How long after a seal went unanswered, or a subscription stopped, a followed scope is sealed again. */
const LIVE_RESTART = Duration.seconds(5);

/** Which inbox: one plan's, or one agent's, by its id. */
export class InboxScopeKey extends Data.Class<{
  readonly kind: (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];
  readonly id: string;
}> {}

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
 * A digest of every item whole, its thread's messages and its files among
 * it, and whether it is unread for the reader: any change to any of them,
 * from any of the read's parts, or the reader marking one read or unread,
 * moves it, so a message landing after its item still wakes a held read.
 * Note that it is Web Crypto's SHA-256, since the host loads where no
 * `node:` module does.
 */
function cursorOf(items: readonly InboxItem[]): Effect.Effect<string> {
  const standing = items.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(standing))),
    ),
    (digest) => `live-${Hex.encode(new Uint8Array(digest)).slice(0, 32)}`,
  );
}

export interface ScopeInboxDependencies {
  /** The scope sealed for following for the account named, or with `poll` its rows inline; not found, signed out, or a failure where the service sealed none. */
  readonly seal: (
    scope: InboxScopeKey,
    poll: boolean,
    userId: string,
    after?: string,
  ) => Effect.Effect<ScopeInboxLiveAnswer | { readonly failure: string }>;
  /** The account signed in now, which a follow is sealed for from its first seal on; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
  /** Where each scope's wait for a write's transaction stands while it is subscribed, which the inbox's writes wait on. */
  readonly txWaits: InboxTxWaits;
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
          return { kind: "refused", failure } as const;
        }
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: "waiting" });
        const rows = liveRows(
          {
            openLive: dependencies.openLive,
            reseal: () => seal(false),
            poll: (after) => seal(true, after),
            now: dependencies.now,
            onTxWait: dependencies.txWaits.hook(),
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

/** A followed inbox as the window is told it: its items whole, or why there are none. */
type Told = CodingAgentInboxChanged["inbox"];

/**
 * The scope's inbox followed until interrupted, each change told whole from
 * its subscription once its first rows land, the same subscription the
 * reads share. One the account does not reach is told not found, which ends
 * the follow. A seal the service did not answer is told unanswered, and it,
 * or a subscription that stopped, is let go and sealed again after
 * `LIVE_RESTART`.
 */
export function followInbox(
  inboxes: ScopeInboxes,
  scope: InboxScopeKey,
  tell: (inbox: Told) => Effect.Effect<void>,
): Effect.Effect<void> {
  const attempt: Effect.Effect<boolean> = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, scope);
      if (standing.kind === "refused") {
        yield* tell({ failure: standing.failure });
        return standing.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND;
      }
      // Note that a delivery that moved nothing is told nobody, since the digest is where every item stands.
      yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.takeWhile((state) => state.kind !== "broken"),
        Stream.filter((state) => state.kind === "standing"),
        Stream.map((state) => state.inbox),
        Stream.changesWith((one, other) => one.cursor === other.cursor),
        Stream.runForEach((inbox) => tell({ items: inbox.items })),
      );
      return false;
    }),
  );
  const again = Effect.andThen(RcMap.invalidate(inboxes, scope), Effect.sleep(LIVE_RESTART));
  const loop: Effect.Effect<void> = Effect.flatMap(attempt, (ended) =>
    ended ? Effect.void : Effect.andThen(again, loop),
  );
  return loop;
}
