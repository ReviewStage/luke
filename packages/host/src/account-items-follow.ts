import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import {
  ACCOUNT_INBOX_ITEMS,
  type AccountInboxItemsLiveAnswer,
  type AccountInboxItemsLiveRows,
  accountInboxItemsLiveRowsSchema,
  type InboxItemStamp,
  inboxInOrder,
  inboxOfLiveRows,
} from "@repo/features/live-wire";
import type { EntityPool, HeldRows } from "@repo/sync";
import { Clock, Effect } from "effect";
import type { AppHostRead, AppInboxItems } from "./app-state.js";
import { type AccountWideReads, INBOX_ITEM, type InboxChange } from "./inbox-collections.js";
import {
  confirmWrite,
  followTakingRows,
  restarting,
  type SyncStanding,
  syncIdOf,
  type TxWait,
} from "./live-follow.js";

/**
 * account-items-follow.ts -- every inbox item the account reaches, whole, followed by sync id over the service's one held poll for the signed-in session and told whole as it moves.
 *
 * The host follows the account's items read (`/api/live/inbox-items`,
 * `live-follow.ts`) for as long as the session's account reads stand
 * (`live-collection.ts`'s `accountReads`), by sync id (`LIVE_POLL.SYNC`):
 * its first answer, and any while it is too far behind, is every item
 * whole, where each stands (`stamps`), its row, and every message and file
 * its thread draws; and each poll after is held until something moves past
 * the id the last answer named, and answered only the items that moved,
 * each whole, with the ids of those that stand no longer for the account
 * (`gone`). The follow keeps every item it holds with the plan it is on, or
 * its agent where that has no task. An item settled longer ago than the
 * read's window leaves it by the clock, which no answer says, so the follow
 * drops it itself; and a sync id that stalls is asked around whole
 * (`live-follow.ts`'s `SYNC_STALL`).
 *
 * The items stand in the sync engine's pool (`inbox-collections.ts`'s
 * `INBOX_ITEM`): each answer upserts only the items it carries, at the sync
 * id it was read at, so an older copy never replaces a newer row another
 * read took, and holds the rest by id. They are told by plan and agent
 * after each answer and each write drawn over them. Only a holder an item
 * on it moved is ordered again, every other's list told as the very one
 * told before, so a change costs the holders it moved rather than the
 * feed's whole. A read the service refused, or a follow that stopped, is
 * read again after `LIVE_RESTART`, whole, keeping what it told; one refused
 * before it ever answered is told as failed.
 */

/** A read the service did not answer, `gone` where it never will again. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

/** The kind of holder an item is on: a plan, or an agent with no task. */
type HolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

/** One item as the follow last took it, and the plan or agent it is on. */
interface HeldItem {
  readonly item: InboxItem;
  readonly kind: HolderKind;
  readonly holder: string;
}

/** Every item held, by its id. */
type Held = ReadonlyMap<string, HeldItem>;

export interface AccountItemsDependencies {
  /** The account's items read for the account named, past the sync id named, whole where it is empty or none; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    sync: string | undefined,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | SealFailure>;
  /** The sync engine's pool, which the items stand in while they are followed. */
  readonly pool: EntityPool;
  /** The account's own reads, among which the feed's wait stands while it is followed. */
  readonly accountWide: AccountWideReads;
}

/** The plan an item's stamp names, or its agent where it has no task. */
function holderOf(stamp: InboxItemStamp): Pick<HeldItem, "kind" | "holder"> {
  return stamp.planId === null
    ? { kind: INBOX_SCOPE_KIND.AGENT, holder: stamp.agentId }
    : { kind: INBOX_SCOPE_KIND.PLAN, holder: stamp.planId };
}

/**
 * The items held after an answer, the items it carried that stand, and the
 * items now on another holder than they were. A whole answer is every item
 * there is; one past a sync id carries only the items that moved, each
 * whole, and names those that stand no longer, which leave, as does every
 * item settled before the read's window, by the clock.
 */
function heldAfter(
  held: Held,
  rows: AccountInboxItemsLiveRows,
  standing: SyncStanding | undefined,
  now: number,
): {
  readonly held: Held;
  readonly sent: readonly InboxItem[];
  readonly placed: readonly string[];
} {
  const carried = new Map(inboxOfLiveRows(rows).map((item) => [item.id, item]));
  const next = new Map<string, HeldItem>(standing?.past === undefined ? [] : held);
  const placed: string[] = [];
  for (const stamp of rows.stamps) {
    const item = carried.get(stamp.id);
    if (item === undefined) continue;
    const on = holderOf(stamp);
    const before = held.get(stamp.id);
    if (before !== undefined && (before.kind !== on.kind || before.holder !== on.holder)) {
      placed.push(stamp.id);
    }
    next.set(stamp.id, { item, ...on });
  }
  for (const id of standing?.gone ?? []) next.delete(id);
  const settledSince = now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS;
  for (const [id, { item }] of next) {
    if (item.status !== INBOX_STATUS.OPEN && item.updatedAt < settledSince) next.delete(id);
  }
  const sent = [...carried.values()].filter((item) => next.has(item.id));
  return { held: next, sent, placed };
}

/** No item on any holder, as the feed is told before it first answers. */
const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.PLAN]: {}, [INBOX_SCOPE_KIND.AGENT]: {} };

/**
 * The holders `told` once the items `moved` names are drawn again: each
 * holder one of them stood on in `was`, or stands on in `held`, holds what
 * `held` puts on it now, each as `drawnOf` draws it, in the order its own read
 * answers them, and is gone where it holds none; every other holder's list
 * is the very one told.
 */
function inboxItemsPatched(
  told: AppInboxItems,
  moved: Iterable<string>,
  was: Held,
  held: Held,
  drawnOf: (id: string) => InboxItem | undefined,
): AppInboxItems {
  const touched = {
    [INBOX_SCOPE_KIND.PLAN]: new Set<string>(),
    [INBOX_SCOPE_KIND.AGENT]: new Set<string>(),
  };
  for (const id of moved) {
    for (const on of [was.get(id), held.get(id)])
      if (on !== undefined) touched[on.kind].add(on.holder);
  }
  const lists = {
    [INBOX_SCOPE_KIND.PLAN]: new Map<string, InboxItem[]>(),
    [INBOX_SCOPE_KIND.AGENT]: new Map<string, InboxItem[]>(),
  };
  for (const [id, { item, kind, holder }] of held) {
    if (!touched[kind].has(holder)) continue;
    const items = lists[kind].get(holder);
    const shown = drawnOf(id) ?? item;
    if (items === undefined) lists[kind].set(holder, [shown]);
    else items.push(shown);
  }
  const ofKind = (kind: HolderKind) => {
    if (touched[kind].size === 0) return told[kind];
    const next = { ...told[kind] };
    for (const holder of touched[kind]) {
      const items = lists[kind].get(holder);
      if (items === undefined) Reflect.deleteProperty(next, holder);
      else next[holder] = inboxInOrder(items);
    }
    return next;
  };
  return {
    [INBOX_SCOPE_KIND.PLAN]: ofKind(INBOX_SCOPE_KIND.PLAN),
    [INBOX_SCOPE_KIND.AGENT]: ofKind(INBOX_SCOPE_KIND.AGENT),
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
      const first = yield* dependencies.seal(userId, "");
      if ("failure" in first) {
        if (!answered) yield* tell({ failed: true });
        return true;
      }
      let wait: TxWait | undefined;
      /** Every item as the follow last took it, with its holder. */
      let held: Held | undefined;
      /** The items as last drawn, a standing write's among them, by the holder each is on. */
      let told = NO_ITEMS;
      /** Tells the items as last drawn, once the read first answered. */
      const toldNow = Effect.suspend(() => {
        if (held === undefined) return Effect.void;
        answered = true;
        return tell({ rows: told });
      });
      /** Draws the items `ids` names again, a write standing over them, on the holders the read answered them on. */
      const drawn = (ids: readonly string[]) =>
        Effect.suspend(() => {
          if (held !== undefined) {
            told = inboxItemsPatched(told, ids, held, held, items.row);
          }
          return toldNow;
        });
      const items: HeldRows<InboxItem, InboxChange> = yield* dependencies.pool.stand(INBOX_ITEM, {
        redraw: drawn,
        confirmation: () => {
          const handed = wait;
          return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
        },
      });
      yield* dependencies.accountWide.stand(() => wait);
      const landed = (decoded: AccountInboxItemsLiveRows, standing?: SyncStanding) =>
        Effect.gen(function* () {
          const was = held ?? new Map<string, HeldItem>();
          const after = heldAfter(was, decoded, standing, yield* Clock.currentTimeMillis);
          held = after.held;
          const at = syncIdOf(standing);
          const moved = yield* items.answer(after.sent, {
            held: [...after.held.keys()],
            ...(at === undefined ? undefined : { at }),
          });
          told = inboxItemsPatched(told, [...moved, ...after.placed], was, after.held, items.row);
          yield* toldNow;
        });
      yield* followTakingRows(
        {
          poll: (_after, _cursor, sync) => dependencies.seal(userId, sync),
          onTxWait: (handed) => {
            wait = handed;
          },
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
