import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { TasklessAgent } from "@repo/features/agent-wire";
import { READ_MARK, type ReadMark, readsUnread } from "@repo/features/read-mark";
import {
  DESCRIPTION_ACTOR,
  type DescriptionSectionEdit,
  type Task,
  type TaskSummary,
} from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actMutation, pressMutation } from "../act-mutations.js";
import { APP_SLICE } from "../use-app-state.js";

/**
 * use-task-looks.ts -- what changed since the developer last looked at a task: the open description's sections, and the sidebar's unread tasks and agents.
 *
 * A look is the plan opened, whichever of its column's tabs it opens on. Its
 * mark is kept on the account by the service (`@repo/features/read-mark`),
 * so a task read on one Mac or browser reads read on every other: the list
 * carries each task's and each agent's mark beside it, and a look, a leave,
 * or a menu moves it through the window's act port, drawn on the row at once
 * and kept once the service answers. The instant is the service's own, never
 * this window's clock.
 *
 * The visit reads the mark its row carries as the plan opens, before this
 * look moves it, and each section a save by anyone but the developer
 * changed after it is a section changed since they last looked, held for the
 * visit until they dismiss it or leave. A section is known by its heading.
 * A save that lands while the task is open is drawn before their eyes, so
 * it never joins the visit's changes.
 *
 * Opening a plan reads it through and takes back a mark of it as unread, as
 * Mail, Slack, and Linear mark a message; leaving it reads it through what
 * landed during the stay and leaves such a mark, so a plan marked unread
 * while the developer is on it stays unread until they leave and come back.
 * So does what its agents finish while it stays open, which every other
 * window of the account then reads as read too. Note that a save landing
 * while it stays open moves no mark until the developer leaves, because the
 * developer's own typing saves every pause and each would be a write.
 *
 * The sidebar reads a task unread while its newest change, its newest save
 * or its agents' newest settled activity where that is later
 * (`newestChangeOf`), is after its mark, or while it stands marked unread,
 * and never the task the developer is watching. A pull request merging or
 * closing on GitHub ends no turn and moves no save, so it alone never makes
 * a task unread. An agent with no task keeps the same marks under its own
 * id, its row's `activityAt` standing where a task's newest change does.
 */

/** One stay on a plan: the mark its row carried as it opened, the newest save the plan named then, and the sections saved between the two, as read for the reader it names. Note that a reader's id arriving mid-stay reads the sections again within that same span, because the sections read without it took every developer's save as the reader's, and a save landing during the stay was watched as it landed. A dismissal closes the span, so no read after it lights a section again. */
interface Visit {
  readonly taskId: string | undefined;
  readonly readerId: string | undefined;
  readonly mark: number | undefined;
  readonly opened: number | undefined;
  readonly changed: ReadonlySet<string>;
}

/** The open description's sections changed since the last look, each by its heading, and the dismissal that clears them. */
export interface TaskLooks {
  readonly changed: ReadonlySet<string>;
  readonly dismiss: () => void;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

/** The looks of a document no task's visit stands behind: nothing changed, and nothing to dismiss. */
export const NO_LOOKS: TaskLooks = { changed: NOTHING_CHANGED, dismiss: () => undefined };

/** The task the developer is looking at now: open, so every save that lands on it is seen. */
const watchedAtom = Atom.make<string | undefined>(undefined);

/** The ids of the tasks and the agents with no task the reader marked unread by hand, as the list carries them. */
const markedUnreadIdsAtom = Atom.map(
  APP_SLICE.TASKS,
  (tasks): ReadonlySet<string> =>
    new Set(
      [...(tasks?.tasks ?? []), ...(tasks?.tasklessAgents ?? [])]
        .filter((row) => row.markedUnread === true)
        .map((row) => row.id),
    ),
);

/** Whether one task or agent is marked unread by hand, so a row reading it draws again only as its own mark moves, never another's. */
const markedUnreadAtom = Atom.family((id: string) =>
  Atom.map(markedUnreadIdsAtom, (marked) => marked.has(id)),
);

/** The save that last changed each of the description's sections, each by its heading. */
function sectionSavesOf(task: Task): readonly DescriptionSectionEdit[] {
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
 * The instant of the newest change in a task the developer may not have
 * seen, which its mark is read against: its newest save, or its agents'
 * newest settled activity where that is later. Note that the agents'
 * activity is read from turns alone (the service's `agentActivityAt`), so a
 * pull request merging or closing, which ends no turn, never moves it.
 */
function newestChangeOf(task: Pick<TaskSummary, "updatedAt" | "agents">): number {
  return Math.max(task.updatedAt, task.agents?.activityAt ?? task.updatedAt);
}

/**
 * Whether a section's save is the reader's own, which they need not be shown
 * as changed: a developer's save naming the reader. Note that a developer's
 * save naming nobody, or read with no account id, counts as theirs, as every
 * developer's save did before saves named their member, because a save the
 * window cannot place is as likely the reader's as anyone's.
 */
function readersOwn(edit: DescriptionSectionEdit, readerId: string | undefined): boolean {
  if (edit.actor !== DESCRIPTION_ACTOR.DEVELOPER) return false;
  return edit.by === undefined || readerId === undefined || edit.by.userId === readerId;
}

/** A visit to the task between `mark`, the last look's, and `opened`: each section someone else, a teammate or the app or an agent, saved in that span; none while no task is drawn. */
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

/** The visit as the task opens, from the mark its row carries then, or as the reader's id arrives on the one already open, whose span it keeps. */
function revisited(
  held: Visit | undefined,
  task: Task | undefined,
  readerId: string | undefined,
  mark: number | undefined,
): Visit {
  if (task === undefined) return visited(undefined, readerId, undefined, undefined);
  if (held !== undefined && held.taskId === task.id)
    return visited(task, readerId, held.mark, held.opened);
  return visited(task, readerId, mark, newestSaveOf(task));
}

/**
 * The drawn description's sections changed since the developer last looked at it,
 * and the plan read: as it opens, which takes back a mark of it as unread,
 * as its agents' activity moves while it stays open, and as it is left,
 * neither of which does. Note that the visit reads the mark `row` carries as
 * it renders, before the look moves it, so the plan opening still lights
 * what changed since the stay before. It is held by the window's shell
 * rather than the task's page, because the task's version history standing
 * in the page's place is still a stay on the task.
 */
export function useTaskLooks(
  task: Task | undefined,
  readerId: string | undefined,
  row?: Pick<TaskSummary, "readThrough" | "agents">,
): TaskLooks {
  const [visit, setVisit] = useState(() => revisited(undefined, task, readerId, row?.readThrough));
  const watch = useAtomSet(watchedAtom);
  let current = visit;
  if (visit.taskId !== task?.id || visit.readerId !== readerId) {
    current = revisited(visit, task, readerId, row?.readThrough);
    setVisit(current);
  }
  const taskId = task?.id;
  const activityAt = row?.agents?.activityAt;
  // Note that a look is sent with `mutate` and no `onError`, quiet whatever comes back, since no person pressed for it.
  const { mutate: markTaskRead } = useMutation(actMutation(ACT_KIND.TASKS_MARK_READ));
  const lookAtTask = useCallback(
    (taskId: string, readMark: ReadMark) => markTaskRead({ taskId, readMark }),
    [markTaskRead],
  );

  useEffect(() => {
    if (taskId === undefined) return;
    watch(taskId);
    lookAtTask(taskId, READ_MARK.READ);
    return () => {
      watch(undefined);
      lookAtTask(taskId, READ_MARK.SEEN);
    };
  }, [taskId, watch, lookAtTask]);

  // Note that the agents' activity the plan opened with is read by the look opening it, so only a move during the stay is a look of its own.
  const seenActivity = useRef<{ taskId: string; activityAt: number | undefined } | undefined>(
    undefined,
  );
  useEffect(() => {
    const seen = seenActivity.current;
    seenActivity.current = taskId === undefined ? undefined : { taskId, activityAt };
    if (taskId === undefined || seen?.taskId !== taskId || seen.activityAt === activityAt) return;
    lookAtTask(taskId, READ_MARK.SEEN);
  }, [taskId, activityAt, lookAtTask]);

  const dismiss = useCallback(() => {
    setVisit((held) =>
      held.taskId === taskId ? { ...held, mark: held.opened, changed: NOTHING_CHANGED } : held,
    );
    if (taskId !== undefined) lookAtTask(taskId, READ_MARK.SEEN);
  }, [taskId, lookAtTask]);
  // The same looks across draws while neither moves, so the plan they are handed to is not drawn again for new ones.
  const { changed } = current;
  return useMemo(() => ({ changed, dismiss }), [changed, dismiss]);
}

/**
 * The agent with no task whose page is on screen, looked at: as it opens,
 * which takes back a mark of it as unread, and again as its row's time moves
 * and as it is left, neither of which does, as `useTaskLooks` reads a plan.
 * Held by the window's shell, none while no agent's page is drawn.
 */
export function useAgentLook(agent: Pick<TasklessAgent, "id" | "activityAt"> | undefined): void {
  const agentId = agent?.id;
  const activityAt = agent?.activityAt;
  // Note that a look is quiet whatever comes back, as `useTaskLooks`' is.
  const { mutate: markAgentRead } = useMutation(actMutation(ACT_KIND.AGENTS_MARK_READ));
  const lookAtAgent = useCallback(
    (agentId: string, readMark: ReadMark) => markAgentRead({ agentId, readMark }),
    [markAgentRead],
  );
  useEffect(() => {
    if (agentId === undefined) return;
    lookAtAgent(agentId, READ_MARK.READ);
    return () => lookAtAgent(agentId, READ_MARK.SEEN);
  }, [agentId, lookAtAgent]);

  const seenActivity = useRef<{ agentId: string; activityAt: number | undefined } | undefined>(
    undefined,
  );
  useEffect(() => {
    const seen = seenActivity.current;
    seenActivity.current = agentId === undefined ? undefined : { agentId, activityAt };
    if (agentId === undefined || seen?.agentId !== agentId || seen.activityAt === activityAt)
      return;
    lookAtAgent(agentId, READ_MARK.SEEN);
  }, [agentId, activityAt, lookAtAgent]);
}

/**
 * Whether each of the sidebar's plans is unread: marked so by hand, or
 * changed after its mark, and not the plan the developer is watching, whose
 * changes are seen as they land. A `staged` run draws nothing unread, so its
 * frames never wear a developer's marks.
 */
export function useUnreadTasks({ staged }: { staged: boolean }): (task: TaskSummary) => boolean {
  const watched = useAtomValue(watchedAtom);
  return (task) => {
    if (staged) return false;
    if (task.markedUnread === true) return true;
    return task.id !== watched && readsUnread(task, newestChangeOf(task));
  };
}

/** Whether an agent with no task reads unread: marked so by hand, or active after its mark. */
export function agentReadsUnread(agent: TasklessAgent): boolean {
  return readsUnread(agent, agent.activityAt);
}

/** Whether the developer marked a plan unread, and the mark a menu sets either way. */
export interface ReadMarks {
  /** The plan the developer is looking at now, none while Settings or the Inbox covers it. */
  readonly watched: string | undefined;
  /** Whether the plan is marked unread by hand: the only way the plan being looked at is unread. */
  readonly markedUnread: (taskId: string) => boolean;
  /** Marks the plan unread until it next opens, or read through now. */
  readonly mark: (task: Pick<TaskSummary, "id">, unread: boolean) => void;
}

/** The mark of a read: unread until the next look, or read through now. */
function readMarkOf(unread: boolean): ReadMark {
  return unread ? READ_MARK.UNREAD : READ_MARK.READ;
}

/** A mark a menu sets by hand: the plan unread until it next opens, or read through now, a failure said in a toast. */
function useMarkTask(): ReadMarks["mark"] {
  const { mutate: markTaskRead } = useMutation(pressMutation(ACT_KIND.TASKS_MARK_READ));
  return useCallback(
    (task, unread) => markTaskRead({ taskId: task.id, readMark: readMarkOf(unread) }),
    [markTaskRead],
  );
}

/** The marks by hand, which every menu offering Mark as unread or Mark as read writes through. */
export function useReadMarks(): ReadMarks {
  const marked = useAtomValue(markedUnreadIdsAtom);
  const watched = useAtomValue(watchedAtom);
  const mark = useMarkTask();
  return { watched, markedUnread: (taskId) => marked.has(taskId), mark };
}

/** Whether the developer marked a plan unread by hand, as its row reads it (`markedUnreadAtom`). */
export function useMarkedUnread(taskId: string): boolean {
  return useAtomValue(markedUnreadAtom(taskId));
}

/**
 * The mark a menu sets by hand (`ReadMarks.mark`) and nothing it reads, so
 * a menu that only writes one never draws again as any plan is marked.
 */
export function useReadMark(): ReadMarks["mark"] {
  return useMarkTask();
}

/** An agent with no task marked unread until its page next opens, or read through now, by hand from a menu. */
export function useMarkAgent(): (agentId: string, unread: boolean) => void {
  const { mutate: markAgentRead } = useMutation(pressMutation(ACT_KIND.AGENTS_MARK_READ));
  return useCallback(
    (agentId, unread) => markAgentRead({ agentId, readMark: readMarkOf(unread) }),
    [markAgentRead],
  );
}
