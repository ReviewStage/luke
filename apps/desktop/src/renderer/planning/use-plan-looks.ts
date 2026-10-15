import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  PLAN_ACTOR,
  type Plan,
  type PlanSectionEdit,
  type PlanSummary,
} from "@luke/features/plan-wire";
import { Option, Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

/**
 * use-plan-looks.ts -- what changed since the developer last looked at a plan on this Mac: the open plan's sections, and the sidebar's unread plans.
 *
 * A look is the plan opened, whichever of its column's tabs it opens on:
 * from then on, every save the developer has the plan open for is one they
 * watched land, so the newest save the plan names is kept as what they last
 * saw. The visit reads the mark the last look left as the plan opens, before
 * this one moves it, and each section a save by anyone but the developer
 * changed after it is a section changed since they last looked, held for the
 * visit until they dismiss it or leave. A section is known by its heading.
 * A save that lands while the plan is open is typed in before
 * their eyes, the notetaker's on a call above all, so it never joins the
 * visit's changes. A plan never looked at on this Mac
 * has no mark and nothing changed: every section would be new.
 *
 * The mark is a save's instant as the service stamped it, never this Mac's
 * clock, so a clock that disagrees with the service's moves nothing. It is
 * this window's to remember, kept in the renderer's own storage by plan id
 * and holding nothing of the plan but that instant; a deleted plan's entry
 * is left behind, a few bytes nothing reads again.
 *
 * The sidebar reads the same marks: a plan saved after its mark is unread,
 * its name in the heavier weight, until a look moves the mark past the save.
 * The first list this Mac reads with unread plans marks every plan in it
 * not yet looked at where it stands, once, so the plans from before are not
 * all unread at once, and so does a list with no plan marked, another
 * account's; a plan arriving later with no mark, from another Mac, is
 * unread once anything has been saved in it since it started.
 */

/** Where the plans' marks are kept in the renderer's storage. */
const STORAGE_KEY = "luke.planLooks";

/** The newest save each plan had when the developer last looked at it, by plan id. */
const storedLooks = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number));

type Looks = typeof storedLooks.Type;

const decodeStored = Schema.decodeUnknownOption(storedLooks);
const encodeStored = Schema.encodeSync(storedLooks);

/** Where it is kept that the plans listed before this Mac read any as unread were marked as read. */
const SEEDED_KEY = "luke.planLooksSeeded";

/** The marks as the window holds them, and whether the plans from before were marked. */
interface KeptLooks {
  readonly marks: Looks;
  readonly seeded: boolean;
}

/**
 * One stay on a plan: the mark the last look left as it opened, and the
 * sections changed since it, as read for the reader it names. Note that a
 * reader's id arriving mid-stay reads the sections again against the mark
 * the stay opened with, because the sections read without it took every
 * developer's save as the reader's, and this stay's own look has moved the
 * kept mark since.
 */
interface Visit {
  readonly planId: string | undefined;
  readonly readerId: string | undefined;
  readonly mark: number | undefined;
  readonly changed: ReadonlySet<string>;
}

/** The open plan's sections changed since the last look, each by its heading, and the dismissal that clears them. */
export interface PlanLooks {
  readonly changed: ReadonlySet<string>;
  readonly dismiss: () => void;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

/** The looks of a document no plan's visit stands behind: nothing changed, and nothing to dismiss. */
export const NO_LOOKS: PlanLooks = { changed: NOTHING_CHANGED, dismiss: () => undefined };

/** The kept marks, or none where none were kept, they no longer read, or storage refuses the read. */
function readLooks(): Looks {
  try {
    return Option.getOrElse(decodeStored(window.localStorage.getItem(STORAGE_KEY)), () => ({}));
  } catch {
    return {};
  }
}

/** Whether the plans from before were marked, which a refused read counts as not. */
function readSeeded(): boolean {
  try {
    return window.localStorage.getItem(SEEDED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Keeps the marks and the seeding; a write that fails costs only a section lit or a plan unread again. */
function writeLooks(kept: KeptLooks): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStored(kept.marks));
    if (kept.seeded) window.localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    // The saves before this look count as unseen on the next read.
  }
}

/**
 * The kept looks, which the open plan's region and the sidebar share, so a
 * look taken on the plan is the sidebar's at once. Written with marks to
 * raise, each moved on only where it is newer, and the seeding once done.
 * Note that a write starts from what storage holds rather than what this
 * window read, because another panel's window keeps its looks there too.
 */
const looksAtom = Atom.writable(
  (): KeptLooks => ({ marks: readLooks(), seeded: readSeeded() }),
  (ctx, raised: KeptLooks) => {
    const stored = readLooks();
    const newer = Object.entries(raised.marks).filter(
      ([planId, at]) => (stored[planId] ?? Number.NEGATIVE_INFINITY) < at,
    );
    const kept = {
      marks: { ...stored, ...Object.fromEntries(newer) },
      seeded: raised.seeded || readSeeded(),
    };
    if (newer.length > 0 || raised.seeded) writeLooks(kept);
    ctx.setSelf(kept);
  },
);

/** The plan the developer is looking at now: open, so every save that lands on it is seen. */
const watchedAtom = Atom.make<string | undefined>(undefined);

/** The save that last changed each of the plan's sections, each by its heading. */
function sectionSavesOf(plan: Plan): readonly PlanSectionEdit[] {
  return plan.sectionEdits ?? [];
}

/**
 * The instant of the newest save the plan names. Note that the document's
 * `updatedAt` stands among its revisions' instants, because the sidebar's row
 * reads that one, and the service stamps it apart from the revision's.
 */
function newestSaveOf(plan: Plan): number {
  return Math.max(
    plan.updatedAt,
    ...(plan.lastEdit === undefined ? [] : [plan.lastEdit.at]),
    ...sectionSavesOf(plan).map((edit) => edit.at),
  );
}

/**
 * Whether a section's save is the reader's own, which they need not be shown
 * as changed: a developer's save naming the reader. Note that a developer's
 * save naming nobody, or read with no account id, counts as theirs, as every
 * developer's save did before saves named their member, because a save the
 * window cannot place is as likely the reader's as anyone's.
 */
function readersOwn(edit: PlanSectionEdit, readerId: string | undefined): boolean {
  if (edit.actor !== PLAN_ACTOR.DEVELOPER) return false;
  return edit.by === undefined || readerId === undefined || edit.by.userId === readerId;
}

/** A visit to the plan at `mark`, the last look's: each section someone else, a teammate or Luke or an agent, saved after it; none while no plan is drawn. */
function visited(
  plan: Plan | undefined,
  readerId: string | undefined,
  mark: number | undefined,
): Visit {
  if (plan === undefined)
    return { planId: undefined, readerId, mark: undefined, changed: NOTHING_CHANGED };
  const changed =
    mark === undefined
      ? NOTHING_CHANGED
      : new Set(
          sectionSavesOf(plan)
            .filter((edit) => !readersOwn(edit, readerId) && edit.at > mark)
            .map((edit) => edit.section),
        );
  return { planId: plan.id, readerId, mark, changed };
}

/** The visit as the plan opens, or as the reader's id arrives on the one already open, whose mark it keeps. */
function revisited(
  held: Visit | undefined,
  plan: Plan | undefined,
  readerId: string | undefined,
): Visit {
  const staying = held !== undefined && plan !== undefined && held.planId === plan.id;
  const mark = staying ? held.mark : plan === undefined ? undefined : readLooks()[plan.id];
  return visited(plan, readerId, mark);
}

/**
 * The drawn plan's sections changed since the developer last looked at it,
 * and the mark moved on at once: as the plan opens, and again with every
 * save while it stays open. Note that the visit reads the last look's mark
 * as it renders, before the effect that moves it runs, so the plan opening
 * still lights what changed since the stay before. It is held by the
 * window's shell rather than the plan's page, because the plan's version
 * history standing in the page's place is still a stay on the plan.
 */
export function usePlanLooks(plan: Plan | undefined, readerId: string | undefined): PlanLooks {
  const [visit, setVisit] = useState(() => revisited(undefined, plan, readerId));
  const keep = useAtomSet(looksAtom);
  const watch = useAtomSet(watchedAtom);
  let current = visit;
  if (visit.planId !== plan?.id || visit.readerId !== readerId) {
    current = revisited(visit, plan, readerId);
    setVisit(current);
  }
  const planId = plan?.id;
  const newest = plan === undefined ? undefined : newestSaveOf(plan);

  useEffect(() => {
    if (planId !== undefined && newest !== undefined)
      keep({ marks: { [planId]: newest }, seeded: false });
  }, [planId, newest, keep]);

  useEffect(() => {
    if (planId === undefined) return;
    watch(planId);
    return () => watch(undefined);
  }, [planId, watch]);

  return {
    changed: current.changed,
    dismiss: () => {
      setVisit((held) => (held.planId === planId ? { ...held, changed: NOTHING_CHANGED } : held));
      if (planId !== undefined && newest !== undefined)
        keep({ marks: { [planId]: newest }, seeded: false });
    },
  };
}

/**
 * Whether each of the sidebar's plans is unread: saved after its mark, or,
 * with none, after it started, and not the plan the developer is watching,
 * whose saves are seen as they land. The first read list marks every plan
 * in it no look has marked, and so does a read list none of whose plans has
 * a mark, which is an account this Mac has not listed before; nothing is
 * unread until it has. A `staged` run draws nothing unread and seeds
 * nothing, so its frames never wear a developer's marks.
 */
export function useUnreadPlans(
  plans: readonly PlanSummary[],
  { listRead, staged }: { listRead: boolean; staged: boolean },
): (plan: PlanSummary) => boolean {
  const looks = useAtomValue(looksAtom);
  const keep = useAtomSet(looksAtom);
  const watched = useAtomValue(watchedAtom);
  const known = plans.some((plan) => looks.marks[plan.id] !== undefined);
  const seeding = !staged && listRead && plans.length > 0 && !(looks.seeded && known);

  // Note that the seeding runs once the list is a read one, because the
  // empty list before the first read would mark nothing and count as done,
  // and that it leaves a plan's look where one was taken, since the saves
  // after it are ones the developer has not seen.
  useEffect(() => {
    if (!seeding) return;
    const unmarked = plans.filter((plan) => looks.marks[plan.id] === undefined);
    keep({
      marks: Object.fromEntries(unmarked.map((plan) => [plan.id, plan.updatedAt])),
      seeded: true,
    });
  }, [seeding, plans, looks.marks, keep]);

  return (plan) =>
    !staged &&
    looks.seeded &&
    known &&
    plan.id !== watched &&
    plan.updatedAt > (looks.marks[plan.id] ?? plan.createdAt);
}
