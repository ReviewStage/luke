import type { AccountInboxAnswer } from "@repo/features/account-inbox-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowsSchema,
  accountInboxOfLiveRows,
  nextFailedRunExpiry,
} from "@repo/features/live-wire";
import type { EntityPool, HeldRows } from "@repo/sync";
import { Clock, Duration, Effect, Queue, RcMap, type Scope, Stream, SubscriptionRef } from "effect";
import {
  type AccountWideReads,
  changedIds,
  INBOX_CHANGE,
  INBOX_ITEM,
  type InboxChange,
  remindAtAfter,
  settles,
} from "./inbox-collections.js";
import { answeredCollection, rowsOf } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_STATE,
  restarting,
  type TxWait,
} from "./live-follow.js";

const IDLE = Duration.seconds(30);

type AnsweredPart = Exclude<keyof AccountInboxLiveAnswer["queries"], "agents">;

type SealFailure = { readonly failure: string; readonly gone?: boolean };

type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly answer: AccountInboxAnswer }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly inbox: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

export interface AccountInboxDependencies {
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountInboxLiveAnswer | SealFailure>;
  readonly pool: EntityPool;
  readonly accountWide: AccountWideReads;
}

export type AccountInboxes = RcMap.RcMap<string, Standing>;

function answersOf(rows: AccountInboxLiveRows): Stream.Stream<AccountInboxAnswer> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(accountInboxOfLiveRows(rows, at));
      const expiry = nextFailedRunExpiry(rows.failedRuns, at);
      if (expiry === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(expiry - at + 1)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => answersOf(rows)),
      );
    }),
  );
}

type Entry = AccountInboxLiveRows["items"][number] | AccountInboxLiveRows["planless"][number];

function entryChanged<Row extends Entry>(
  change: InboxChange,
  entry: Row,
): Row | "gone" | undefined {
  if (!changedIds(change).includes(entry.id)) return undefined;
  if (change.kind === INBOX_CHANGE.REMINDED) {
    const until = remindAtAfter(entry.remindAt, change) ?? null;
    return (entry.remindAt ?? null) === until ? undefined : { ...entry, remindAt: until };
  }
  if (change.kind === INBOX_CHANGE.ANSWERED && entry.updatedAt > change.item.updatedAt) {
    return undefined;
  }
  if (settles(change)) return "gone";
  const unread =
    change.kind === INBOX_CHANGE.MARKED
      ? change.unread
      : change.kind === INBOX_CHANGE.ANSWERED
        ? change.item.unread === true
        : false;
  return (entry.unread === true) === unread ? undefined : { ...entry, unread };
}

function counted(entry: AccountInboxLiveRows["items"][number], readerId: string): boolean {
  const waitsOn = entry.waitsOn ?? entry.startedBy ?? readerId;
  return entry.asking !== false && waitsOn === readerId;
}

type Changeable = Pick<AccountInboxLiveRows, "items" | "planless" | "plans">;

function rowsChanged(
  rows: Changeable,
  change: InboxChange,
  readerId: string,
): Changeable | undefined {
  const answered = new Map<string, number>();
  let moved = false;
  const kept = <Row extends Entry>(each: readonly Row[]) =>
    each.flatMap((entry) => {
      const changed = entryChanged(change, entry);
      if (changed === undefined) return [entry];
      moved = true;
      if (changed !== "gone") return [changed];
      if ("planId" in entry && counted(entry, readerId)) {
        answered.set(entry.planId, (answered.get(entry.planId) ?? 0) + 1);
      }
      return [];
    });
  const items = kept(rows.items);
  const planless = kept(rows.planless);
  const plans = rows.plans.map((plan) => {
    const fewer = answered.get(plan.planId) ?? 0;
    return fewer === 0 || plan.toDo === undefined
      ? plan
      : { ...plan, toDo: Math.max(0, plan.toDo - fewer) };
  });
  return moved ? { items, planless, plans } : undefined;
}

export function accountInboxes(
  dependencies: AccountInboxDependencies,
): Effect.Effect<AccountInboxes, never, Scope.Scope> {
  return RcMap.make({
    idleTimeToLive: IDLE,
    lookup: (userId: string) =>
      Effect.gen(function* () {
        const first = yield* dependencies.seal(userId, false);
        if ("failure" in first) return { kind: LIVE_STATE.BROKEN } as const;
        const inbox = yield* SubscriptionRef.make<LiveState>({ kind: LIVE_STATE.WAITING });
        const items = yield* answeredCollection({ getKey: (row: Entry) => row.id });
        const planless = yield* answeredCollection({ getKey: (row: Entry) => row.id });
        const plans = yield* answeredCollection({
          getKey: (row: AccountInboxLiveRows["plans"][number]) => row.planId,
        });
        let wait: TxWait | undefined;
        let answered: AccountInboxLiveRows | undefined;
        const taken = (rows: AccountInboxLiveRows) => {
          items.answer(rows.items);
          planless.answer(rows.planless);
          plans.answer(rows.plans);
          answered = rows;
        };
        const shown = (): Changeable => {
          const held: Changeable = {
            items: rowsOf(items.collection) as AccountInboxLiveRows["items"],
            planless: rowsOf(planless.collection) as AccountInboxLiveRows["planless"],
            plans: rowsOf(plans.collection),
          };
          return writes
            .standing()
            .reduce((rows, change) => rowsChanged(rows, change, userId) ?? rows, held);
        };
        const standing = yield* Queue.sliding<AccountInboxLiveRows>(1);
        const drawn = Effect.suspend(() =>
          answered === undefined ? Effect.void : Queue.offer(standing, { ...answered, ...shown() }),
        );
        const lists = (id: string) =>
          answered !== undefined &&
          (answered.items.some((entry) => entry.id === id) ||
            answered.planless.some((entry) => entry.id === id));
        const writes: HeldRows<InboxItem, InboxChange> = yield* dependencies.pool.stand(
          INBOX_ITEM,
          {
            redraw: () => Effect.asVoid(drawn),
            confirmation: () => {
              const handed = wait;
              return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
            },
            beside: {
              shows: lists,
              take: (change) => {
                const next =
                  answered === undefined ? undefined : rowsChanged(answered, change, userId);
                if (answered !== undefined && next !== undefined) taken({ ...answered, ...next });
              },
            },
          },
        );
        yield* dependencies.accountWide.stand(() => wait);
        const follow = followTakingRows<AnsweredPart, AccountInboxLiveRows>(
          {
            poll: (after) => dependencies.seal(userId, true, after),
            onTxWait: (handed) => {
              wait = handed;
            },
          },
          first,
          accountInboxLiveRowsSchema,
          (rows) =>
            Effect.suspend(() => {
              taken(rows);
              return drawn;
            }),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(Stream.switchMap(Stream.fromQueue(standing), answersOf), (answer) =>
            SubscriptionRef.set(inbox, { kind: LIVE_STATE.STANDING, answer }),
          ),
        );
        yield* Effect.forkScoped(
          follow.pipe(
            Effect.catch(() => Effect.void),
            Effect.ensuring(SubscriptionRef.set(inbox, { kind: LIVE_STATE.BROKEN })),
          ),
        );
        return { kind: LIVE_STATE.LIVE, inbox } as const;
      }),
  });
}

export function followAccountInbox(
  inboxes: AccountInboxes,
  userId: string,
  tell: (answer: AccountInboxAnswer) => Effect.Effect<void>,
): Effect.Effect<void> {
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const standing = yield* RcMap.get(inboxes, userId);
      if (standing.kind === LIVE_STATE.BROKEN) return;
      yield* SubscriptionRef.changes(standing.inbox).pipe(
        Stream.takeWhile((state) => state.kind !== LIVE_STATE.BROKEN),
        Stream.filter((state) => state.kind === LIVE_STATE.STANDING),
        Stream.runForEach((state) => tell(state.answer)),
      );
    }),
  );
  return restarting(
    attempt.pipe(Effect.andThen(RcMap.invalidate(inboxes, userId)), Effect.as(true)),
  );
}
