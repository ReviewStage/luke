import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInboxPlan, AppInboxPlanHolding } from "#shared/messages/app-state";

/**
 * inbox-reads.ts -- which of each plan's waiting inbox items the developer has seen on this Mac: what the Inbox's unread dots and counts are drawn from.
 *
 * An item is read once its plan's inbox was on screen while it waited: the
 * plan's Inbox tab chosen, or the plan chosen in the window's Inbox. Each
 * plan keeps the waiting items it last showed, by id, and nothing else, so
 * an item the agent edits while it waits stays read, and one answered and
 * posted again under its key is unread once more, having left what was kept
 * as it settled. What is settled, answered or taken back, is never unread:
 * only an item that waits can be. Main's read of the account says so too,
 * on no screen: an item a plan holding items no longer has waiting leaves
 * that plan's marks then, so one answered and posted again while neither
 * board was on screen is unread all the same. A plan main names nowhere,
 * as every plan before main's first answer, keeps its marks. The marks are this window's to remember,
 * kept in the renderer's own storage as a plan's looks are
 * (`use-plan-looks.ts`), so a read on one Mac leaves the item unread on
 * another. A fixture run starts with nothing read and keeps nothing.
 */

/** Where the marks are kept in the renderer's storage. */
const STORAGE_KEY = "luke.inboxReads";

/**
 * How many plans' marks are kept, the latest written. Note that a deleted
 * plan's marks are left behind, so the record is held to a bound rather
 * than growing with every plan ever read; one past it reads as unread.
 */
const PLANS_KEPT = 500;

/** The waiting items each plan last showed, by plan id. */
const storedReads = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);

/** The waiting items each plan last showed, by plan id. */
type InboxReads = typeof storedReads.Type;

const decodeStored = Schema.decodeUnknownOption(storedReads);
const encodeStored = Schema.encodeSync(storedReads);

const NOTHING_READ: InboxReads = {};

/** The kept marks, or none where none were kept, they no longer read, or storage refuses the read. */
function readStored(): InboxReads {
  try {
    return Option.getOrElse(decodeStored(window.localStorage.getItem(STORAGE_KEY)), () => ({}));
  } catch {
    return NOTHING_READ;
  }
}

/** Keeps the marks; a write that fails costs only an item unread again on the next launch. */
function writeStored(reads: InboxReads): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStored(reads));
  } catch {
    // The items read since count as unread on the next launch.
  }
}

/** The plan's waiting items it has not shown while they waited. */
function unreadItems(
  reads: InboxReads,
  planId: string,
  waiting: readonly string[],
): readonly string[] {
  const seen = reads[planId] ?? [];
  return waiting.filter((item) => !seen.includes(item));
}

/**
 * The marks with the plan's shown items read: exactly those, the plan kept
 * latest and the oldest let go past the bound. The marks as they stood
 * where the plan already showed exactly these.
 */
function withSeen(reads: InboxReads, planId: string, shown: readonly string[]): InboxReads {
  const was = reads[planId];
  if (was !== undefined && was.length === shown.length && shown.every((id) => was.includes(id))) {
    return reads;
  }
  const kept = Object.entries(reads).filter(([plan]) => plan !== planId);
  return Object.fromEntries([...kept, [planId, shown] as const].slice(-PLANS_KEPT));
}

/**
 * The marks with every item main no longer says waits let go: each plan main
 * names as waiting keeps only its marks still waiting, and each it names as
 * holding only settled items keeps none. A plan named nowhere keeps its own,
 * since nothing is known of it. The marks as they stood where nothing moved.
 */
function withWaiting(
  reads: InboxReads,
  waiting: readonly AppInboxPlan[],
  holding: readonly AppInboxPlanHolding[],
): InboxReads {
  const named = new Map<string, readonly string[]>(holding.map((plan) => [plan.planId, []]));
  for (const plan of waiting) named.set(plan.planId, plan.items);
  let moved = false;
  const kept = Object.entries(reads).map(([planId, seen]): [string, readonly string[]] => {
    const standing = named.get(planId);
    if (standing === undefined) return [planId, seen];
    const still = seen.filter((item) => standing.includes(item));
    if (still.length !== seen.length) moved = true;
    return [planId, still];
  });
  return moved ? Object.fromEntries(kept) : reads;
}

/** What the Inbox draws of the marks, and the press that moves them. */
export interface InboxReadsControl {
  /** How many of the plan's waiting items it has not shown. */
  readonly unread: (planId: string) => number;
  /** How many waiting items, across every plan, have not been shown. */
  readonly total: number;
  /** Marks the items the plan's inbox shows waiting as read. */
  readonly onSeen: (planId: string, shown: readonly string[]) => void;
}

/** The marks over what waits across the account and the plans holding items, each kept as it moves unless the run is `staged`. */
export function useInboxReads(
  waiting: readonly AppInboxPlan[],
  holding: readonly AppInboxPlanHolding[],
  staged: boolean,
): InboxReadsControl {
  // Note that a fixture run's marks are a state of their own rather than the
  // kept ones reset, because the run is only known a render after the kept
  // marks were read, as `folded-groups.ts` says of its folds.
  const [kept, setKept] = useState(readStored);
  const [stagedReads, setStagedReads] = useState<InboxReads>(NOTHING_READ);
  const reads = staged ? stagedReads : kept;
  const onSeen = useCallback(
    (planId: string, shown: readonly string[]) => {
      if (staged) {
        setStagedReads((held) => withSeen(held, planId, shown));
        return;
      }
      setKept((held) => withSeen(held, planId, shown));
    },
    [staged],
  );
  // What main says no longer waits leaves the marks as main says it.
  useEffect(() => {
    (staged ? setStagedReads : setKept)((held) => withWaiting(held, waiting, holding));
  }, [staged, waiting, holding]);
  // Note that the marks are written after they change rather than as they
  // do, because an update React asks for twice must not write twice.
  const written = useRef(kept);
  useEffect(() => {
    if (staged || written.current === kept) return;
    written.current = kept;
    writeStored(kept);
  }, [staged, kept]);
  const counts = useMemo(
    () =>
      new Map(
        waiting.map((plan) => [plan.planId, unreadItems(reads, plan.planId, plan.items).length]),
      ),
    [reads, waiting],
  );
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const unread = useCallback((planId: string) => counts.get(planId) ?? 0, [counts]);
  return { unread, total, onSeen };
}
