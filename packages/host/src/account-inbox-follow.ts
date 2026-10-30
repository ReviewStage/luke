import type { AccountInboxAnswer } from "@luke/features/account-inbox-wire";
import {
  type AccountInboxLiveAnswer,
  type AccountInboxLiveRows,
  accountInboxLiveRowsSchema,
  accountInboxOfLiveRows,
  nextFailedRunExpiry,
} from "@luke/features/live-wire";
import { Clock, Duration, Effect, Queue, RcMap, type Scope, Stream, SubscriptionRef } from "effect";
import {
  changedIds,
  INBOX_CHANGE,
  type InboxChange,
  type InboxReads,
  settles,
} from "./inbox-collections.js";
import { answeredCollection, rowsOf } from "./live-collection.js";
import { followTakingRows, LIVE_STATE, restarting, type TxWait } from "./live-follow.js";

/**
 * account-inbox-follow.ts -- what waits on the developer across the account, followed over the service's held poll and told to main each time it moves.
 *
 * The host follows the account's live read (`live-follow.ts`) once main
 * follows the account inbox, builds the answer the held read answered from
 * each delivery (`accountInboxOfLiveRows`), and tells main each one, which
 * its notices, the Dock badge, and the Inbox tab observe. A failed run ages
 * out of the last week with no row moving, so the answer is built again as
 * it does. A read refused as signed out ends the follow, which is read again
 * after `LIVE_RESTART`. Only the answer built from the rows leaves.
 *
 * The rows of its open items, those of agents with no task, and the tasks
 * holding them stand in collections among the reads an inbox write reaches
 * (`inbox-collections.ts`), each answer taken as its poll answers. So an
 * item the reader settles leaves what waits, its task counting one question
 * fewer where it asked the reader, and a mark flips its dot, the moment the
 * write is asked, and the answer is built again as each lands.
 */

/** How long a follow no reader holds is kept, so a reader started again soon finds it standing. */
const IDLE = Duration.seconds(30);

/**
 * The parts every service answers, which the follow is typed by. Note that a
 * part only a newer service answers, its agents holding items, is followed
 * too where the first answer carries it, since the follow takes its parts
 * from that answer.
 */
type AnsweredPart = Exclude<keyof AccountInboxLiveAnswer["queries"], "agents">;

/** A read the service did not answer, `gone` where it never will again. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

/** A follow before its first rows, with the answer they make, or stopped for good. */
type LiveState =
  | { readonly kind: typeof LIVE_STATE.WAITING }
  | { readonly kind: typeof LIVE_STATE.STANDING; readonly answer: AccountInboxAnswer }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

/** What an account's read is answered from: its follow, or that the service answered none. */
type Standing =
  | {
      readonly kind: typeof LIVE_STATE.LIVE;
      readonly inbox: SubscriptionRef.SubscriptionRef<LiveState>;
    }
  | { readonly kind: typeof LIVE_STATE.BROKEN };

export interface AccountInboxDependencies {
  /** The account's read for the account named, its rows inline, held past `after` where it names one; signed out, or a failure where the service answered none. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountInboxLiveAnswer | SealFailure>;
  /** The reads an inbox write reaches, among which each account's stands while it is followed. */
  readonly reads: InboxReads;
}

/** Each account's follow, by its id, held while main reads it and a while after. */
export type AccountInboxes = RcMap.RcMap<string, Standing>;

/** The answer the rows make now, and again each time a failed run they carry ages out, until the rows move. */
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

/** An open item as the read lists it, a task's or an agent's with no task. */
type Entry = AccountInboxLiveRows["items"][number] | AccountInboxLiveRows["planless"][number];

/** What a change leaves of an open item: gone where it settles it, its read mark where it flips it, and none where it leaves it alone, as an item changed since the service answered it. */
function entryChanged<Row extends Entry>(
  change: InboxChange,
  entry: Row,
): Row | "gone" | undefined {
  // Note that a thread moved leaves its open item as it stood, since the read lists no channel.
  if (change.kind === INBOX_CHANGE.MOVED || !changedIds(change).includes(entry.id)) {
    return undefined;
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

/** Whether a task's open item is a question waiting on the reader, as its task's count counts it. */
function counted(entry: AccountInboxLiveRows["items"][number], readerId: string): boolean {
  const waitsOn = entry.waitsOn ?? entry.startedBy ?? readerId;
  return entry.asking !== false && waitsOn === readerId;
}

/** The parts of the read a write changes. */
type Changeable = Pick<AccountInboxLiveRows, "items" | "planless" | "plans">;

/**
 * The rows a change leaves of the read: each open item it settles gone and
 * its task counting it no longer, and each it marks flipped; none where it
 * moves no row.
 */
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

/** The map a composer holds for as long as it stands. */
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
        /** The rows as the read last answered them, or a write's own answer took them in its place; none before it first answers. */
        let answered: AccountInboxLiveRows | undefined;
        /** Takes rows as the read's own, every part's. */
        const taken = (rows: AccountInboxLiveRows) => {
          items.answer(rows.items);
          planless.answer(rows.planless);
          plans.answer(rows.plans);
          answered = rows;
        };
        /** The rows as the read holds them, each write standing drawn over them in turn. */
        const shown = (): Changeable => {
          const held: Changeable = {
            // SAFETY: each collection holds only the rows of its own part, which the read answered.
            items: rowsOf(items.collection) as AccountInboxLiveRows["items"],
            planless: rowsOf(planless.collection) as AccountInboxLiveRows["planless"],
            plans: rowsOf(plans.collection),
          };
          return dependencies.reads
            .standingWrites()
            .reduce((rows, change) => rowsChanged(rows, change, userId) ?? rows, held);
        };
        // The answer built again from the rows as they stand each time they move, and as a failed run they carry ages out.
        const standing = yield* Queue.sliding<AccountInboxLiveRows>(1);
        const drawn = Effect.suspend(() =>
          answered === undefined ? Effect.void : Queue.offer(standing, { ...answered, ...shown() }),
        );
        yield* dependencies.reads.stand({
          shown,
          take: (change) => {
            const next = answered === undefined ? undefined : rowsChanged(answered, change, userId);
            if (answered !== undefined && next !== undefined) taken({ ...answered, ...next });
          },
          txWait: () => wait,
          drawn,
          accountWide: true,
        });
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

/**
 * What waits across the account for `userId`, told whole each time it moves,
 * until the fiber is let go. A read the service refused, or a follow that
 * stopped, is let go and read again after `LIVE_RESTART`, for whoever the
 * caller follows then.
 */
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
