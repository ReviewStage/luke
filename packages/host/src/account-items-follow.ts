import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
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
import { Effect, Ref } from "effect";
import type { AppHostRead, AppInboxItems } from "./app-state.js";
import { type InboxReads, itemsRead } from "./inbox-collections.js";
import { followTakingRows, restarting, type TxWait } from "./live-follow.js";

/**
 * account-items-follow.ts -- every inbox item the account reaches, whole, followed over the service's one held poll for the signed-in session and told whole as it moves.
 *
 * The host follows the account's items read (`/api/live/inbox-items`,
 * `live-follow.ts`) for as long as the session's account reads stand
 * (`live-collection.ts`'s `accountReads`). Each answer carries where
 * every item stands (`stamps`), which is the whole set, and the items
 * changed since the instant the poll named (`since`) whole; the poll is
 * held on the stamps alone (`ACCOUNT_INBOX_ITEMS.HELD_ON`). The follow
 * keeps every item it was sent, with the plan it is on, or its agent where
 * that has no task, and asks each poll past the latest change it holds.
 *
 * Some moves change a stamp without resending its item. A read mark and a
 * move between channels are patched from the stamp. Any other (who it
 * waits on, a withdrawn message) asks once again past no digest, from that
 * item's change, so it is resent. An item no stamp names any more is gone,
 * and dropped.
 *
 * The items stand in a collection among the reads an inbox write reaches
 * (`inbox-collections.ts`), each answer taken as its poll answers, and are
 * told whole, by plan and agent, after each answer and each write drawn
 * over them. A read the service refused, or a follow that stopped, is read
 * again after `LIVE_RESTART`, keeping what it told; one refused before it
 * ever answered is told as failed.
 */

/**
 * What of a stamp moves only with its item resent, so a stamp moving on any
 * of them with no resend asks for the item again: who it waits on and how
 * many messages its thread holds move with no change to the item's own.
 */
const RESENT_ON = ["revision", "version", "status", "updatedAt", "waitsOn", "messages"] as const;

/** A read the service did not answer, `gone` where it never will again. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

/** The kind of holder an item is on: a plan, or an agent with no task. */
type HolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

/** One item as the follow holds it: whole, the stamp it was last sent with, its read mark and channel kept current, and the plan or agent it is on. */
interface HeldItem {
  readonly item: InboxItem;
  readonly sent: InboxItemStamp;
  readonly kind: HolderKind;
  readonly holder: string;
}

/** Every item held, by its id. */
type Held = ReadonlyMap<string, HeldItem>;

/** What the next poll asks: the instant it is sent every item changed since, none for every item, and whether it asks past no digest, so an item whose stamp moved alone is sent. */
interface Asking {
  readonly since: number | undefined;
  readonly again: boolean;
}

export interface AccountItemsDependencies {
  /** The account's items read for the account named, those changed since `since` whole, its rows inline where `poll`, held past `after` where it names one; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    since: number | undefined,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | SealFailure>;
  /** The reads an inbox write reaches, among which the account's stands while it is followed. */
  readonly reads: InboxReads;
}

/** The plan an item's stamp names, or its agent where it has no task. */
function holderOf(stamp: InboxItemStamp): Pick<HeldItem, "kind" | "holder"> {
  return stamp.planId === null
    ? { kind: INBOX_SCOPE_KIND.AGENT, holder: stamp.agentId }
    : { kind: INBOX_SCOPE_KIND.PLAN, holder: stamp.planId };
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
    const on = holderOf(stamp);
    const before = held.get(stamp.id);
    const item = sent.get(stamp.id);
    if (item !== undefined) {
      // Note that an item sent again as it stood stays the object held, so its holder's list keeps its identity where nothing moved.
      const same = before !== undefined && JSON.stringify(before.item) === JSON.stringify(item);
      next.set(stamp.id, { item: same ? before.item : item, sent: stamp, ...on });
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
    next.set(stamp.id, { item: patched.item, sent: patched.sent, ...on });
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

/** Every item held, as `shown` draws it where it holds it, by its plan or agent, each holder's in the order its own read answers them. */
function inboxItemsOf(held: Held, shown: ReadonlyMap<string, InboxItem>): AppInboxItems {
  const grouped = {
    [INBOX_SCOPE_KIND.PLAN]: new Map<string, InboxItem[]>(),
    [INBOX_SCOPE_KIND.AGENT]: new Map<string, InboxItem[]>(),
  };
  for (const [id, { item, kind, holder }] of held) {
    const drawn = shown.get(id) ?? item;
    const items = grouped[kind].get(holder);
    if (items === undefined) grouped[kind].set(holder, [drawn]);
    else items.push(drawn);
  }
  const ordered = (holders: ReadonlyMap<string, InboxItem[]>) =>
    Object.fromEntries([...holders].map(([holder, items]) => [holder, inboxInOrder(items)]));
  return {
    [INBOX_SCOPE_KIND.PLAN]: ordered(grouped[INBOX_SCOPE_KIND.PLAN]),
    [INBOX_SCOPE_KIND.AGENT]: ordered(grouped[INBOX_SCOPE_KIND.AGENT]),
  };
}

/**
 * Every item the account `userId` reaches, told whole until the fiber is
 * let go: once the first rows land, then after each answer and each write
 * drawn over them. A read the service refused, or a follow that stopped, is
 * read again after `LIVE_RESTART`; one refused before any answer is told
 * as failed, and one after keeps what was told.
 */
export function followAccountItems(
  dependencies: AccountItemsDependencies,
  userId: string,
  tell: (read: AppHostRead<AppInboxItems>) => Effect.Effect<void>,
): Effect.Effect<void> {
  /** Whether any read answered, so a later refusal keeps what was told. */
  let answered = false;
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* dependencies.seal(userId, undefined, false);
      if ("failure" in first) {
        if (!answered) yield* tell({ failed: true });
        return true;
      }
      const asking = yield* Ref.make<Asking>({ since: undefined, again: false });
      const read = yield* itemsRead();
      let wait: TxWait | undefined;
      /** Every item as the read last answered it, with the stamp it was sent with and its holder. */
      let held: Held | undefined;
      /** The stamps last asked for again, so a stamp whose item the service does not send is asked for once rather than every poll. */
      let askedFor: string | undefined;
      /** The items as they stand, a standing write's among them, each on the holder the read answered it on. */
      const drawn = Effect.suspend(() => {
        if (held === undefined) return Effect.void;
        answered = true;
        const shown = new Map(read.shown().map((item) => [item.id, item]));
        return tell({ rows: inboxItemsOf(held, shown) });
      });
      yield* dependencies.reads.stand({
        draw: read.draw,
        take: read.take,
        txWait: () => wait,
        drawn,
        accountWide: true,
      });
      // Note that a poll already held when a stamp moved alone asks again only once it answers, by the hold's end at the latest.
      const landed = (decoded: AccountInboxItemsLiveRows) =>
        Effect.gen(function* () {
          const after = heldAfter(held ?? new Map(), decoded);
          held = after.held;
          read.items.answer([...after.held.values()].map((kept) => kept.item));
          const unsent = after.unsent.length === 0 ? undefined : JSON.stringify(after.unsent);
          const again = unsent !== undefined && unsent !== askedFor;
          askedFor = unsent;
          yield* Ref.set(asking, {
            since: sinceOf(after.held, again ? after.unsent : []),
            again,
          });
          yield* drawn;
        });
      yield* followTakingRows(
        {
          poll: (after) =>
            Effect.flatMap(
              Ref.getAndUpdate(asking, (asked) => ({ ...asked, again: false })),
              ({ since, again }) =>
                dependencies.seal(userId, since, true, again ? undefined : after),
            ),
          onTxWait: (handed) => {
            wait = handed;
          },
          heldOn: ACCOUNT_INBOX_ITEMS.HELD_ON,
        },
        first,
        accountInboxItemsLiveRowsSchema,
        landed,
      ).pipe(Effect.catch(() => Effect.void));
      return true;
    }),
  );
  return restarting(attempt);
}
