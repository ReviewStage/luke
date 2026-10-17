import { createHash } from "node:crypto";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxChanged,
} from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START, type InboxItem } from "@luke/features/inbox-wire";
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
 * the service seals nothing for, an older service or one without Realtime,
 * is read through the held read as before; one the account does not reach
 * is not found, as the held read said.
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
  | { readonly kind: "held" }
  | { readonly kind: "refused"; readonly failure: typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND };

/** A subscription before its first rows, with them, or stopped for good. */
type LiveState =
  | { readonly kind: "waiting" }
  | { readonly kind: "standing"; readonly inbox: LiveInbox }
  | { readonly kind: "broken" };

/** A digest of where every item stands: any change to any of them moves it, as the service's cursor moves. */
function cursorOf(items: readonly InboxItem[]): string {
  const standing = items
    .map((item) => [item.id, item.revision, item.status, item.updatedAt] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `live-${createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, 32)}`;
}

export interface ScopeInboxDependencies {
  /** The scope sealed for following; not found, or a failure where the service sealed none. */
  readonly seal: (
    scope: InboxScopeKey,
  ) => Effect.Effect<ScopeInboxLiveAnswer | { readonly failure: string }>;
  readonly openLive: (url: string) => LiveClient;
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
          return first.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
            ? ({ kind: "refused", failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } as const)
            : ({ kind: "held" } as const);
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
                return SubscriptionRef.set(inbox, {
                  kind: "standing",
                  inbox: { items, cursor: cursorOf(items) },
                });
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
 * once it does within the hold, or unchanged once the hold ends. The held
 * read answers it where the scope is not followed live, or where its
 * subscription stopped or had nothing to say within the hold.
 */
export function inboxPast(
  inboxes: ScopeInboxes,
  scope: InboxScopeKey,
  after: string,
  held: Effect.Effect<CodingAgentInboxAnswerView>,
): Effect.Effect<CodingAgentInboxAnswerView> {
  return Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, scope);
      if (standing.kind === "held") return yield* held;
      if (standing.kind === "refused") return { failure: standing.failure };
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
      return state.kind === "standing"
        ? { items: state.inbox.items, cursor: state.inbox.cursor }
        : yield* held;
    }),
  );
}

/** A followed inbox as the window is told it: its items whole, or why there are none. */
type Told = CodingAgentInboxChanged["inbox"];

/** The held read, one after another from the start, each answer told, until one does not answer, which is told and ends it. */
function heldReads(
  held: (after: string) => Effect.Effect<CodingAgentInboxAnswerView>,
  tell: (inbox: Told) => Effect.Effect<void>,
): Effect.Effect<void> {
  const next = (after: string): Effect.Effect<void> =>
    Effect.flatMap(held(after), (answer) =>
      "failure" in answer
        ? tell({ failure: answer.failure })
        : Effect.andThen(tell({ items: answer.items }), next(answer.cursor)),
    );
  return Effect.suspend(() => next(INBOX_CURSOR_START));
}

/**
 * The scope's inbox followed until interrupted, each change told whole: from
 * its subscription where the service seals it, once its first rows land; by
 * the held read, one after another, where it does not, and from the moment
 * the subscription stops for good. A subscription with nothing to say within
 * the hold has the held read answer once meanwhile, as a read held that long
 * was. One the account does not reach is told not found, and a held read that
 * did not answer is told so; either ends the follow, and following again
 * starts over.
 */
export function followInbox(
  inboxes: ScopeInboxes,
  scope: InboxScopeKey,
  held: (after: string) => Effect.Effect<CodingAgentInboxAnswerView>,
  tell: (inbox: Told) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, scope);
      if (standing.kind === "refused") return yield* tell({ failure: standing.failure });
      if (standing.kind === "held") return yield* heldReads(held, tell);
      const settled = yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.filter((state) => state.kind !== "waiting"),
        Stream.runHead,
        Effect.timeoutOption(HOLD),
        Effect.map(Option.flatten),
      );
      if (Option.isNone(settled)) {
        const answer = yield* held(INBOX_CURSOR_START);
        if ("failure" in answer) return yield* tell({ failure: answer.failure });
        yield* tell({ items: answer.items });
      }
      // Note that a delivery that moved nothing is told nobody, since the digest is where every item stands.
      yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.takeWhile((state) => state.kind !== "broken"),
        Stream.filter((state) => state.kind === "standing"),
        Stream.map((state) => state.inbox),
        Stream.changesWith((one, other) => one.cursor === other.cursor),
        Stream.runForEach((inbox) => tell({ items: inbox.items })),
      );
      yield* heldReads(held, tell);
    }),
  );
}
