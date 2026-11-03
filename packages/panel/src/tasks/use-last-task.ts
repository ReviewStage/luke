import type { TaskSummary } from "@repo/features/task-wire";
import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { keptKey, useKept } from "../use-kept.js";

/**
 * use-last-task.ts -- the task each account last had open, kept across launches, and opened again at the next launch where it still stands.
 *
 * A launch opens the window on the task the account had open when it quit,
 * once the task list says it is still one of the account's; its tabs, the one shown, and its side panel come back with it,
 * because those are kept by task already (`use-main-tabs.ts`,
 * `use-side-panel.ts`). A task deleted since, or none open at
 * quit, leaves the window on the home page. The task names its workspace,
 * so opening it lists that workspace, as opening a task from the palette
 * does, and a task of a workspace the account has left is not listed, so it
 * is not opened.
 *
 * The task is kept by account, so another account signed in on this Mac
 * never opens it; it is kept as the host opens it, and let go when the host
 * closes it, as leaving it for the home page does. Until the list is read,
 * the window is restoring and draws no home page, so a task about to open
 * does not flash the home page first; once the task is asked for it stays
 * restoring until the host has it open, or the ask is taken back. A list
 * read that failed leaves the home page standing, and the read its Try
 * again lands still opens the task. A link opened before the reopen is
 * decided, as a fresh tab opened at any place's address is, stands over
 * it, so the reopen opens nothing. A fixture run keeps nothing and opens nothing, as it draws tasks of its
 * own.
 *
 * A narrow room reopens nothing either, and opens on Home. Note that we
 * keep the task all the same, because a phone shows one pane of it, which
 * is the agent's transcript once its plan was left there, and landing on
 * that at every launch reads as being dropped mid-conversation, while
 * Home's Recent lists the tasks worked on latest, a tap away; a wide room shows the
 * task's panes side by side, as it was left, and still reopens it.
 */

/** Each account's last open task, by the account's email. */
const storedTasks = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

type KeptTasks = typeof storedTasks.Type;

/** Where the tasks are kept in the renderer's storage, and where they were kept before tasks had their name. */
const KEPT = { TASKS: keptKey("app.lastTask", storedTasks, "app.lastPlan") } as const;

const NONE_KEPT: KeptTasks = {};

/** The kept tasks with the account's set to `planId`, or let go with none. */
function withKept(kept: KeptTasks, account: string, taskId: string | undefined): KeptTasks {
  if (kept[account] === taskId) return kept;
  if (taskId !== undefined) return { ...kept, [account]: taskId };
  const { [account]: _gone, ...rest } = kept;
  return rest;
}

/** Whether the window is still restoring the task last open, and the way a link standing over the reopen forgoes it. */
export interface LastTask {
  readonly restoring: boolean;
  /** Forgoes the launch's reopen where it is not yet decided; nothing once it is. */
  readonly forgo: () => void;
}

/**
 * Keeps the task open for `account`, the signed-in account's email or none,
 * and opens the kept one through `select` once `plans` are read. Answers
 * whether the window is still restoring it. `boundFor` is the task the tab
 * is bound for, the one asked for before the host answers.
 */
export function useLastTask(input: {
  staged: boolean;
  account: string | undefined;
  tasks: readonly TaskSummary[];
  listStatus: TasksView["listStatus"];
  openTaskId: string | undefined;
  boundFor: string | undefined;
  /** Whether the room is narrow, a phone's, which opens on Home rather than reopening the task. */
  narrow: boolean;
  select: (taskId: string) => void;
}): LastTask {
  const { staged, account, tasks, listStatus, openTaskId, boundFor, narrow, select } = input;
  const [kept, , keep] = useKept(KEPT.TASKS, NONE_KEPT);
  // The account the launch's reopen was decided for, and the task it asked for.
  const [decided, setDecided] = useState<{ account: string; asked?: string } | undefined>(
    undefined,
  );
  // The task last seen open, and the account it was open for.
  const wasOpen = useRef<{ account: string; taskId: string } | undefined>(undefined);
  // Whether a link forwent the launch's first reopen before it was decided, which that decision takes up.
  const [forgone, setForgone] = useState(false);
  const undecided = useRef(true);
  undecided.current = decided === undefined;
  const forgo = useCallback(() => {
    if (undecided.current) setForgone(true);
  }, []);

  // The task the host opens is kept, and let go once it closes. Note that
  // only a close seen in this run, under the same account, lets it go,
  // because nothing is open at a launch until the reopen opens it, and a
  // sign-out closes the task of the account leaving, not the next one's.
  useEffect(() => {
    if (staged || account === undefined) {
      wasOpen.current = undefined;
      return;
    }
    const was = wasOpen.current;
    wasOpen.current = openTaskId === undefined ? undefined : { account, taskId: openTaskId };
    if (openTaskId !== undefined) keep((held) => withKept(held, account, openTaskId));
    else if (was?.account === account) keep((held) => withKept(held, account, undefined));
  }, [staged, account, openTaskId, keep]);

  // Once per account signed in, as soon as the list is read: the kept task
  // where it is listed, else nothing, and a kept task the
  // list does not offer is let go. A read that failed decides nothing, so
  // the read Try again lands still reopens it. A window reloaded over a
  // task the host still holds has nothing to reopen.
  const keptTask = account === undefined ? undefined : kept[account];
  useEffect(() => {
    if (staged || account === undefined || decided?.account === account) return;
    if (openTaskId !== undefined || forgone || narrow) {
      setForgone(false);
      setDecided({ account });
      return;
    }
    if (listStatus !== TASKS_READ.READY) return;
    const task = tasks.find((each) => each.id === keptTask);
    if (task === undefined) {
      if (keptTask !== undefined) keep((held) => withKept(held, account, undefined));
      setDecided({ account });
      return;
    }
    setDecided({ account, asked: task.id });
    select(task.id);
  }, [
    staged,
    account,
    decided,
    forgone,
    narrow,
    openTaskId,
    listStatus,
    tasks,
    keptTask,
    select,
    keep,
  ]);

  // Note that a failed read leaves the home page standing, with the
  // sidebar's Try again, rather than the bare ground until the list reads.
  const settled = staged || account === undefined || openTaskId !== undefined;
  const ours = decided !== undefined && decided.account === account ? decided : undefined;
  const restoring = settled
    ? false
    : ours === undefined
      ? !forgone && !narrow && keptTask !== undefined && listStatus !== TASKS_READ.FAILED
      : ours.asked !== undefined && boundFor === ours.asked;
  return { restoring, forgo };
}
