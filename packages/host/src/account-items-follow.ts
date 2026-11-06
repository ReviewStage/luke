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

type SealFailure = { readonly failure: string; readonly gone?: boolean };

type HolderKind = (typeof INBOX_SCOPE_KIND)[keyof typeof INBOX_SCOPE_KIND];

interface HeldItem {
  readonly item: InboxItem;
  readonly kind: HolderKind;
  readonly holder: string;
}

type Held = ReadonlyMap<string, HeldItem>;

export interface AccountItemsDependencies {
  readonly seal: (
    userId: string,
    sync: string | undefined,
  ) => Effect.Effect<AccountInboxItemsLiveAnswer | SealFailure>;
  readonly pool: EntityPool;
  readonly accountWide: AccountWideReads;
}

function holderOf(stamp: InboxItemStamp): Pick<HeldItem, "kind" | "holder"> {
  return stamp.planId === null
    ? { kind: INBOX_SCOPE_KIND.AGENT, holder: stamp.agentId }
    : { kind: INBOX_SCOPE_KIND.PLAN, holder: stamp.planId };
}

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
    if (item.status === INBOX_STATUS.OPEN) continue;
    const standsBy = Math.max(
      item.updatedAt,
      item.settledAt ?? item.updatedAt,
      item.remindAt ?? item.updatedAt,
    );
    if (standsBy < settledSince) next.delete(id);
  }
  const sent = [...carried.values()].filter((item) => next.has(item.id));
  return { held: next, sent, placed };
}

const NO_ITEMS: AppInboxItems = { [INBOX_SCOPE_KIND.PLAN]: {}, [INBOX_SCOPE_KIND.AGENT]: {} };

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

export function followAccountItems(
  dependencies: AccountItemsDependencies,
  userId: string,
  tell: (read: AppHostRead<AppInboxItems>) => Effect.Effect<void>,
): Effect.Effect<void> {
  let answered = false;
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* dependencies.seal(userId, "");
      if ("failure" in first) {
        if (!answered) yield* tell({ failed: true });
        return true;
      }
      let wait: TxWait | undefined;
      let held: Held | undefined;
      let told = NO_ITEMS;
      const toldNow = Effect.suspend(() => {
        if (held === undefined) return Effect.void;
        answered = true;
        return tell({ rows: told });
      });
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
