import {
  type CodingAgentAccountItems,
  type CodingAgentScopeItems,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import {
  ACCOUNT_INBOX_ITEMS,
  type AccountInboxItemsLiveAnswer,
  type AccountInboxItemsLiveRows,
  accountInboxItemsLiveRowsSchema,
  type InboxItemStamp,
  inboxInOrder,
  inboxOfLiveRows,
} from "@luke/features/live-wire";
import {
  Duration,
  Effect,
  MutableHashMap,
  Option,
  RcMap,
  Ref,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { InboxTxWaits } from "./inbox-tx-waits.js";
import { decodedLiveRows, LIVE_STATE, restarting } from "./live-follow.js";
import { InboxScopeKey } from "./scope-inbox-follow.js";

/**
 * account-items-follow.ts -- every inbox item the account reaches, whole, followed over the service's one held poll and told to a window by the plans and agents that moved.
 *
 * The host follows the account's items read (`/api/live/inbox-items`,
 * `live-follow.ts`) once a window follows it. Each answer carries where
 * every item stands (`stamps`), which is the whole set, and the items
 * changed since the instant the poll named (`since`) whole; the poll is
 * held on the stamps alone (`ACCOUNT_INBOX_ITEMS.HELD_ON`). The follow
 * keeps every item it was sent, grouped by its plan, or by its agent where
 * that has no task, and asks each poll past the latest change it holds.
 *
 * Some moves change a stamp without resending its item. A read mark and a
 * move between channels are patched from the stamp. Any other (who it
 * waits on, a withdrawn message) asks once again past no digest, from that
 * item's change, so it is resent. An item no stamp names any more is gone,
 * and dropped.
 *
 * A window is told every plan and agent holding any as the follow starts
 * (`whole`), then only those that moved, one holding nothing now with no
 * items. A read refused as signed out ends the follow, which is read again
 * after `LIVE_RESTART`, and told whole again.
 */

/** How long a follow no reader holds is kept, so a window coming back finds it standing. */
const IDLE = Duration.seconds(30);

/**
 * What of a stamp moves only with its item resent, so a stamp moving on any
 * of them with no resend asks for the item again: who it waits on and how
 * many messages its thread holds move with no change to the item's own.
 */
const RESENT_ON = ["revision", "version", "status", "updatedAt", "waitsOn", "messages"] as const;

/** A read the service did not answer, `gone` where it never will again. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

/** One item as the follow holds it: whole, the stamp it was last sent with, its read mark and channel kept current, and the plan or agent it is grouped under. */
interface HeldItem {
  readonly item: InboxItem;
  readonly sent: InboxItemStamp;
  readonly scope: InboxScopeKey;
}

/** Every item held, by its id. */
type Held = ReadonlyMap<string, HeldItem>;

/** A follow before its first rows, with the items they hold, or stopped for good. */
type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly held: Held }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

/** What an account's read is answered from: its follow, or that the service answered none. */
type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly items: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

/** What the next poll asks: the instant it is sent every item changed since, none for every item, and whether it asks past no digest, so an item whose stamp moved alone is sent. */
interface Asking {
  readonly since: number | undefined;
  readonly again: boolean;
}

/** Every plan's and agent's items, each in the held read's order. */
type Scopes = MutableHashMap.MutableHashMap<InboxScopeKey, readonly InboxItem[]>;

export interface AccountItemsDependencies {
  /** The account's items read for the account named, those changed since `since` whole, its rows inline where `poll`, held past `after` where it names one; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    since: number | undefined,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | SealFailure>;
  /** Where the inboxes' waits for a write's transaction stand while followed, which the inbox's writes wait on. */
  readonly txWaits: InboxTxWaits;
}

/** Each account's follow, by its id, held while a window reads it and a while after. */
export type AccountItems = RcMap.RcMap<string, Standing>;

/** The plan an item's stamp names, or its agent where it has no task. */
function scopeOf(stamp: InboxItemStamp): InboxScopeKey {
  return stamp.planId === null
    ? new InboxScopeKey({ kind: INBOX_SCOPE_KIND.AGENT, id: stamp.agentId })
    : new InboxScopeKey({ kind: INBOX_SCOPE_KIND.PLAN, id: stamp.planId });
}

/**
 * The items held after an answer, and the stamps that moved with no item
 * sent: each item the answer sent taken whole, kept as it was held where it
 * is sent unchanged; each other held item's read mark patched from its
 * stamp, and its channel; and every item no stamp names dropped.
 */
function heldAfter(
  held: Held,
  rows: AccountInboxItemsLiveRows,
): { readonly held: Held; readonly unsent: readonly InboxItemStamp[] } {
  const sent = new Map(inboxOfLiveRows(rows).map((item) => [item.id, item]));
  const next = new Map<string, HeldItem>();
  const unsent: InboxItemStamp[] = [];
  for (const stamp of rows.stamps) {
    const scope = scopeOf(stamp);
    const before = held.get(stamp.id);
    const item = sent.get(stamp.id);
    if (item !== undefined) {
      // Note that an item sent again as it stood stays the object held, so the plan it is on is told only when it moved.
      const same = before !== undefined && JSON.stringify(before.item) === JSON.stringify(item);
      next.set(stamp.id, { item: same ? before.item : item, sent: stamp, scope });
      continue;
    }
    if (before === undefined) {
      unsent.push(stamp);
      continue;
    }
    if (RESENT_ON.some((field) => before.sent[field] !== stamp[field])) unsent.push(stamp);
    const patched =
      before.sent.unread === stamp.unread && before.sent.channelId === stamp.channelId
        ? before
        : {
            item: { ...before.item, unread: stamp.unread, channelId: stamp.channelId },
            sent: { ...before.sent, unread: stamp.unread, channelId: stamp.channelId },
          };
    next.set(stamp.id, { item: patched.item, sent: patched.sent, scope });
  }
  return { held: next, unsent };
}

/** The instant the next poll is sent every item changed since: the latest change held, or earlier, the change of each stamp `again` asks for; none while nothing is held. */
function sinceOf(held: Held, again: readonly InboxItemStamp[]): number | undefined {
  let since: number | undefined;
  for (const { item } of held.values()) since = Math.max(since ?? item.updatedAt, item.updatedAt);
  for (const stamp of again) since = Math.min(since ?? stamp.updatedAt, stamp.updatedAt);
  return since;
}

/** Every plan's and agent's items held, each in the order the held read answers a scope's. */
function scopesOf(held: Held): Scopes {
  const grouped = MutableHashMap.empty<InboxScopeKey, InboxItem[]>();
  for (const { item, scope } of held.values()) {
    const items = MutableHashMap.get(grouped, scope);
    if (Option.isSome(items)) items.value.push(item);
    else MutableHashMap.set(grouped, scope, [item]);
  }
  const scopes: Scopes = MutableHashMap.empty();
  for (const [scope, items] of grouped) MutableHashMap.set(scopes, scope, inboxInOrder(items));
  return scopes;
}

/** A scope's items as the window is told them. */
function toldScope(scope: InboxScopeKey, items: readonly InboxItem[]): CodingAgentScopeItems {
  return { scope: { kind: scope.kind, id: scope.id }, items };
}

/** Whether two lists hold the same items, as the follow holds each, in the same order. */
function sameItems(one: readonly InboxItem[], other: readonly InboxItem[]): boolean {
  return one.length === other.length && one.every((item, index) => item === other[index]);
}

/** What the window is told of `now`: every scope where nothing was told before, else the scopes that moved since `before`, one gone with no items. */
function toldOf(before: Scopes | undefined, now: Scopes): CodingAgentAccountItems {
  if (before === undefined) {
    return { whole: true, scopes: [...now].map(([scope, items]) => toldScope(scope, items)) };
  }
  const moved: CodingAgentScopeItems[] = [];
  for (const [scope, items] of now) {
    const was = MutableHashMap.get(before, scope);
    if (Option.isNone(was) || !sameItems(was.value, items)) moved.push(toldScope(scope, items));
  }
  for (const [scope] of before) {
    if (!MutableHashMap.has(now, scope)) moved.push(toldScope(scope, []));
  }
  return { whole: false, scopes: moved };
}

/** The map a composer holds for as long as it stands. */
export function accountItems(
  dependencies: AccountItemsDependencies,
): Effect.Effect<AccountItems, never, Scope.Scope> {
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (userId: string) =>
      Effect.gen(function* () {
        const first = yield* dependencies.seal(userId, undefined, false);
        if ("failure" in first) return { kind: LIVE_STATE.BROKEN } as const;
        const items = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        const asking = yield* Ref.make<Asking>({ since: undefined, again: false });
        const rows = decodedLiveRows(
          {
            poll: (after) =>
              Effect.flatMap(
                Ref.getAndUpdate(asking, (asked) => ({ ...asked, again: false })),
                ({ since, again }) =>
                  dependencies.seal(userId, since, true, again ? undefined : after),
              ),
            onTxWait: dependencies.txWaits.hook(),
            heldOn: ACCOUNT_INBOX_ITEMS.HELD_ON,
          },
          first,
          accountInboxItemsLiveRowsSchema,
        );
        let held: Held = new Map();
        /** The stamps last asked for again, so a stamp whose item the service does not send is asked for once rather than every poll. */
        let askedFor: string | undefined;
        // Note that a poll already held when a stamp moved alone asks again only once it answers, by the hold's end at the latest.
        const landed = (decoded: AccountInboxItemsLiveRows) =>
          Effect.gen(function* () {
            const after = heldAfter(held, decoded);
            held = after.held;
            const unsent = after.unsent.length === 0 ? undefined : JSON.stringify(after.unsent);
            const again = unsent !== undefined && unsent !== askedFor;
            askedFor = unsent;
            yield* Ref.set(asking, { since: sinceOf(held, again ? after.unsent : []), again });
            yield* SubscriptionRef.set(items, { kind: LIVE_STATE.STANDING, held });
          });
        yield* Effect.forkScoped(
          Stream.runForEach(rows, landed).pipe(
            Effect.catch(() => Effect.void),
            Effect.ensuring(SubscriptionRef.set(items, { kind: LIVE_STATE.BROKEN })),
          ),
        );
        return { kind: LIVE_STATE.LIVE, items } as const;
      }),
  });
}

/**
 * Every item the account `userId` reaches, told by plan and agent until the
 * fiber is let go: every one holding any once the first rows land, then
 * those that moved. A read the service refused, or a follow that stopped,
 * is let go and read again after `LIVE_RESTART`, and told whole again.
 */
export function followAccountItems(
  items: AccountItems,
  userId: string,
  tell: (told: CodingAgentAccountItems) => Effect.Effect<void>,
): Effect.Effect<void> {
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(items, userId);
      if (standing.kind === LIVE_STATE.BROKEN) return;
      yield* SubscriptionRef.changes(standing.items).pipe(
        Stream.takeWhile((state) => state.kind !== LIVE_STATE.BROKEN),
        Stream.filter((state) => state.kind === LIVE_STATE.STANDING),
        Stream.map((state) => scopesOf(state.held)),
        Stream.mapAccum(
          (): Scopes | undefined => undefined,
          (before, now) => [now, [toldOf(before, now)]] as const,
        ),
        Stream.filter((told) => !("whole" in told) || told.whole || told.scopes.length > 0),
        Stream.runForEach(tell),
      );
    }),
  );
  return restarting(attempt.pipe(Effect.andThen(RcMap.invalidate(items, userId)), Effect.as(true)));
}
