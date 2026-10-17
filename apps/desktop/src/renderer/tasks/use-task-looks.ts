import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  PLAN_ACTOR,
  type PlanSectionEdit,
  type Task,
  type TaskSummary,
} from "@luke/features/task-wire";
import { Option, Schema, SchemaTransformation } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

/**
 * use-task-looks.ts -- what changed since the developer last looked at a task on this Mac: the open plan's sections, and the sidebar's unread tasks.
 *
 * A look is the plan opened, whichever of its column's tabs it opens on:
 * from then on, every save the developer has the plan open for is one they
 * watched land, so the newest save the plan names is kept as what they last
 * saw. The visit reads the mark the last look left as the plan opens, before
 * this one moves it, and each section a save by anyone but the developer
 * changed after it is a section changed since they last looked, held for the
 * visit until they dismiss it or leave. A section is known by its heading.
 * A save that lands while the task is open is typed in before
 * their eyes, the notetaker's on a call above all, so it never joins the
 * visit's changes. A task never looked at on this Mac
 * has no mark and nothing changed: every section would be new.
 *
 * The mark is a save's instant as the service stamped it, never this Mac's
 * clock, so a clock that disagrees with the service's moves nothing. It is
 * this window's to remember, kept in the renderer's own storage by task id
 * and holding nothing of the task but that instant; a deleted task's entry
 * is left behind, a few bytes nothing reads again.
 *
 * The sidebar reads the same marks: a task saved after its mark is unread,
 * its name in the heavier weight, until a look moves the mark past the save.
 * The first list this Mac reads with unread tasks marks every task in it
 * not yet looked at where it stands, once, so the tasks from before are not
 * all unread at once, and so does a list with no task marked, another
 * account's; a task arriving later with no mark, from another Mac, is
 * unread once anything has been saved in it since it started.
 *
 * A plan can also be marked unread by hand, as Mail, Slack, and Linear mark
 * a message: its entry keeps the mark it had and says it is unread all the
 * same, until the plan next opens. Note that only opening it takes that
 * back, never a save landing while it stays open, so a plan marked unread
 * while the developer is on it stays unread until they leave and come back.
 * Its sections changed since the last look are lit as before, against the
 * mark kept beside the word, so a mark by hand changes only the row's weight.
 * Marked read from a menu, a plan is looked at without opening: its mark
 * moves to its newest save, and the next visit lights nothing from before.
 */

/** Where the tasks' marks are kept in the renderer's storage. */
const STORAGE_KEY = { NOW: "luke.taskLooks", EARLIER: "luke.planLooks" } as const;

/**
 * One plan's look: the newest save it had when the developer last looked,
 * kept as that instant alone, or that beside their word that it is unread,
 * with no instant where they marked it unread before any look.
 */
const storedLook = Schema.Union([
  Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Struct({ at: Schema.Number, unread: Schema.Literal(false) }),
      SchemaTransformation.transform({
        decode: (at) => ({ at, unread: false as const }),
        encode: (look) => look.at,
      }),
    ),
  ),
  Schema.Struct({ at: Schema.optionalKey(Schema.Number), unread: Schema.Literal(true) }),
]);

/** Each plan's look, by plan id. */
const storedLooks = Schema.fromJsonString(Schema.Record(Schema.String, storedLook));

type Look = typeof storedLook.Type;

type Looks = typeof storedLooks.Type;

const decodeStored = Schema.decodeUnknownOption(storedLooks);
const encodeStored = Schema.encodeSync(storedLooks);

/** Where it is kept that the tasks listed before this Mac read any as unread were marked as read. */
const SEEDED_KEY = { NOW: "luke.taskLooksSeeded", EARLIER: "luke.planLooksSeeded" } as const;

/** The marks as the window holds them, and whether the tasks from before were marked. */
interface KeptLooks {
  readonly marks: Looks;
  readonly seeded: boolean;
}

/** A write to the kept looks: what it makes of the marks storage holds, the same marks where it moves none, and whether it seeds. */
interface LooksChange {
  readonly change: (stored: Looks) => Looks;
  readonly seeded: boolean;
}

/**
 * One stay on a plan: the mark the last look left as it opened, the newest
 * save the plan named then, and the sections saved between the two, as read
 * for the reader it names. Note that a reader's id arriving mid-stay reads
 * the sections again within that same span, because the sections read
 * without it took every developer's save as the reader's, this stay's own
 * look has moved the kept mark since, and a save landing during the stay
 * was watched as it landed. A dismissal closes the span, so no read
 * after it lights a section again.
 */
interface Visit {
  readonly taskId: string | undefined;
  readonly readerId: string | undefined;
  readonly mark: number | undefined;
  readonly opened: number | undefined;
  readonly changed: ReadonlySet<string>;
}

/** The open plan's sections changed since the last look, each by its heading, and the dismissal that clears them. */
export interface TaskLooks {
  readonly changed: ReadonlySet<string>;
  readonly dismiss: () => void;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

/** The looks of a document no task's visit stands behind: nothing changed, and nothing to dismiss. */
export const NO_LOOKS: TaskLooks = { changed: NOTHING_CHANGED, dismiss: () => undefined };

/** The newest save the developer looked at, or none where they never looked. */
function markOf(look: Look | undefined): number | undefined {
  return look?.at;
}

/** Whether the developer marked the plan unread by hand. */
function markedUnread(look: Look | undefined): boolean {
  return look?.unread === true;
}

/** The kept marks, or none where none were kept, they no longer read, or storage refuses the read. */
function readLooks(): Looks {
  try {
    const text =
      window.localStorage.getItem(STORAGE_KEY.NOW) ??
      window.localStorage.getItem(STORAGE_KEY.EARLIER);
    return Option.getOrElse(decodeStored(text), () => ({}));
  } catch {
    return {};
  }
}

/** Whether the tasks from before were marked, which a refused read counts as not. */
function readSeeded(): boolean {
  try {
    return (
      window.localStorage.getItem(SEEDED_KEY.NOW) !== null ||
      window.localStorage.getItem(SEEDED_KEY.EARLIER) !== null
    );
  } catch {
    return false;
  }
}

/** Keeps the marks and the seeding; a write that fails costs only a section lit or a task unread again. */
function writeLooks(kept: KeptLooks): void {
  try {
    window.localStorage.setItem(STORAGE_KEY.NOW, encodeStored(kept.marks));
    if (kept.seeded) window.localStorage.setItem(SEEDED_KEY.NOW, "1");
  } catch {
    // The saves before this look count as unseen on the next read.
  }
}

/**
 * The marks raised to each plan's instant where it is newer, a plan marked
 * unread kept so unless the look `opens` it, which takes the word back.
 */
function raised(raises: Readonly<Record<string, number>>, opens: boolean) {
  return (stored: Looks): Looks => {
    const moved = Object.entries(raises).flatMap(([planId, at]) => {
      const look = stored[planId];
      const mark = Math.max(markOf(look) ?? at, at);
      const unread = markedUnread(look) && !opens;
      if (mark === markOf(look) && unread === markedUnread(look)) return [];
      const next: Look = unread ? { at: mark, unread: true } : { at: mark, unread: false };
      return [[planId, next] as const];
    });
    return moved.length === 0 ? stored : { ...stored, ...Object.fromEntries(moved) };
  };
}

/** The marks with the plan marked unread, keeping the mark its last look left. */
function flagged(planId: string) {
  return (stored: Looks): Looks => {
    const look = stored[planId];
    if (markedUnread(look)) return stored;
    const at = markOf(look);
    return { ...stored, [planId]: at === undefined ? { unread: true } : { at, unread: true } };
  };
}

/**
 * The kept looks, which the open plan's region and the sidebar share, so a
 * look taken on the plan is the sidebar's at once. Written with a change to
 * the marks, which raises each only where it is newer or marks one unread,
 * and the seeding once done. Note that a write starts from what storage
 * holds rather than what this window read, because another panel's window
 * keeps its looks there too.
 */
const looksAtom = Atom.writable(
  (): KeptLooks => ({ marks: readLooks(), seeded: readSeeded() }),
  (ctx, { change, seeded }: LooksChange) => {
    const stored = readLooks();
    const kept = { marks: change(stored), seeded: seeded || readSeeded() };
    if (kept.marks !== stored || seeded) writeLooks(kept);
    ctx.setSelf(kept);
  },
);

/** The task the developer is looking at now: open, so every save that lands on it is seen. */
const watchedAtom = Atom.make<string | undefined>(undefined);

/** The save that last changed each of the plan's sections, each by its heading. */
function sectionSavesOf(task: Task): readonly PlanSectionEdit[] {
  return task.sectionEdits ?? [];
}

/**
 * The instant of the newest save the task names. Note that the document's
 * `updatedAt` stands among its revisions' instants, because the sidebar's row
 * reads that one, and the service stamps it apart from the revision's.
 */
function newestSaveOf(task: Task): number {
  return Math.max(
    task.updatedAt,
    ...(task.lastEdit === undefined ? [] : [task.lastEdit.at]),
    ...sectionSavesOf(task).map((edit) => edit.at),
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

/** A visit to the task between `mark`, the last look's, and `opened`: each section someone else, a teammate or Luke or an agent, saved in that span; none while no task is drawn. */
function visited(
  task: Task | undefined,
  readerId: string | undefined,
  mark: number | undefined,
  opened: number | undefined,
): Visit {
  if (task === undefined)
    return {
      taskId: undefined,
      readerId,
      mark: undefined,
      opened: undefined,
      changed: NOTHING_CHANGED,
    };
  const changed =
    mark === undefined || opened === undefined
      ? NOTHING_CHANGED
      : new Set(
          sectionSavesOf(task)
            .filter((edit) => !readersOwn(edit, readerId) && edit.at > mark && edit.at <= opened)
            .map((edit) => edit.section),
        );
  return { taskId: task.id, readerId, mark, opened, changed };
}

/** The visit as the task opens, or as the reader's id arrives on the one already open, whose span it keeps. */
function revisited(
  held: Visit | undefined,
  task: Task | undefined,
  readerId: string | undefined,
): Visit {
  if (task === undefined) return visited(undefined, readerId, undefined, undefined);
  if (held !== undefined && held.taskId === task.id)
    return visited(task, readerId, held.mark, held.opened);
  return visited(task, readerId, markOf(readLooks()[task.id]), newestSaveOf(task));
}

/**
 * The drawn plan's sections changed since the developer last looked at it,
 * and the mark moved on at once: as the plan opens, which takes back a mark
 * of it as unread, and again with every save while it stays open, which
 * leaves one. Note that the visit reads the last look's mark
 * as it renders, before the effect that moves it runs, so the plan opening
 * still lights what changed since the stay before. It is held by the
 * window's shell rather than the task's page, because the task's version
 * history standing in the page's place is still a stay on the task.
 */
export function useTaskLooks(task: Task | undefined, readerId: string | undefined): TaskLooks {
  const [visit, setVisit] = useState(() => revisited(undefined, task, readerId));
  const keep = useAtomSet(looksAtom);
  const watch = useAtomSet(watchedAtom);
  let current = visit;
  if (visit.taskId !== task?.id || visit.readerId !== readerId) {
    current = revisited(visit, task, readerId);
    setVisit(current);
  }
  const planId = task?.id;
  const newest = task === undefined ? undefined : newestSaveOf(task);
  const looked = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (planId === undefined || newest === undefined) {
      looked.current = undefined;
      return;
    }
    const opens = looked.current !== planId;
    looked.current = planId;
    keep({ change: raised({ [planId]: newest }, opens), seeded: false });
  }, [planId, newest, keep]);

  useEffect(() => {
    if (planId === undefined) return;
    watch(planId);
    return () => watch(undefined);
  }, [planId, watch]);

  return {
    changed: current.changed,
    dismiss: () => {
      setVisit((held) =>
        held.taskId === planId ? { ...held, mark: held.opened, changed: NOTHING_CHANGED } : held,
      );
      if (planId !== undefined && newest !== undefined)
        keep({ change: raised({ [planId]: newest }, false), seeded: false });
    },
  };
}

/**
 * Whether each of the sidebar's plans is unread: marked so by hand, or saved
 * after its mark, or, with none, after it started, and not the plan the
 * developer is watching, whose saves are seen as they land. The first read
 * list marks every plan in it no look has marked, and so does a read list
 * none of whose plans has a mark, which is an account this Mac has not
 * listed before; nothing but a mark by hand is unread until it has. A `staged` run draws nothing unread and seeds
 * nothing, so its frames never wear a developer's marks.
 */
export function useUnreadTasks(
  tasks: readonly TaskSummary[],
  { listRead, staged }: { listRead: boolean; staged: boolean },
): (task: TaskSummary) => boolean {
  const looks = useAtomValue(looksAtom);
  const keep = useAtomSet(looksAtom);
  const watched = useAtomValue(watchedAtom);
  const known = tasks.some((task) => looks.marks[task.id] !== undefined);
  const seeding = !staged && listRead && tasks.length > 0 && !(looks.seeded && known);

  // Note that the seeding runs once the list is a read one, because the
  // empty list before the first read would mark nothing and count as done,
  // and that it leaves a task's look where one was taken, since the saves
  // after it are ones the developer has not seen.
  useEffect(() => {
    if (!seeding) return;
    const unmarked = tasks.filter((task) => looks.marks[task.id] === undefined);
    keep({
      change: raised(Object.fromEntries(unmarked.map((plan) => [plan.id, plan.updatedAt])), false),
      seeded: true,
    });
  }, [seeding, tasks, looks.marks, keep]);

  return (plan) => {
    if (staged) return false;
    const look = looks.marks[plan.id];
    if (markedUnread(look)) return true;
    return (
      looks.seeded &&
      known &&
      plan.id !== watched &&
      plan.updatedAt > (markOf(look) ?? plan.createdAt)
    );
  };
}

/** Whether the developer marked a plan unread, and the mark a menu sets either way. */
export interface ReadMarks {
  /** The plan the developer is looking at now, none while Settings or the Inbox covers it. */
  readonly watched: string | undefined;
  /** Whether the plan is marked unread by hand: the only way the plan being looked at is unread. */
  readonly markedUnread: (planId: string) => boolean;
  /** Marks the plan unread until it next opens, or read, as a look at its newest save. */
  readonly mark: (plan: Pick<TaskSummary, "id" | "updatedAt">, unread: boolean) => void;
}

/** The marks by hand, which every menu offering Mark as unread or Mark as read writes through. */
export function useReadMarks(): ReadMarks {
  const looks = useAtomValue(looksAtom);
  const keep = useAtomSet(looksAtom);
  const watched = useAtomValue(watchedAtom);
  return {
    watched,
    markedUnread: (planId) => markedUnread(looks.marks[planId]),
    mark: (plan, unread) =>
      keep({
        change: unread ? flagged(plan.id) : raised({ [plan.id]: plan.updatedAt }, true),
        seeded: false,
      }),
  };
}
