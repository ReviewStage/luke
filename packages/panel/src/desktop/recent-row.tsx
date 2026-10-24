import { TASK_BOUNDS, type TaskSummary } from "@luke/features/task-wire";
import { ANNOUNCE, InlineEdit, ListRow, OneLine, RowHint, RowHintOptions, Time } from "@luke/ui";
import { assigneeFace } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { useCallback, useMemo, useRef } from "react";
import { AssigneeFaceMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { PlanGlyph } from "../tasks/tab-look.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
import { strandedHome } from "./move-task-dialog.js";
import { useTaskMenuItems } from "./task-actions.js";
import { TaskRowMark, taskCardOf } from "./task-card.js";

/**
 * recent-row.tsx -- a plan as a person's page lists it: its glyph, the name, and at its end the repository, who is on it, and its mark and time, hanging its card and offering the sidebar's menu.
 */

/**
 * A plan as a `ListRow`, read as its sidebar row reads it: led by its glyph
 * (`PlanGlyph`), the name, and at its end the repository, the face of who
 * is on it (`assigneeFace`): a teammate's where they are assigned, the
 * dashed unassigned mark where no one is, and none where the reader is;
 * then its row's mark and time. Who made it is never its face, and stays on
 * its card (`taskCardOf`), which it hangs beside it while the pointer rests
 * on it. Unread as the sidebar counts it, its name stands in the heavier
 * weight, and its menu offers to mark it read. Its acts are the sidebar row's (`useTaskMenuItems`), one menu
 * opened alike by its ⋯, a right-click, and the menu key; renamed from it,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row. It wears the task's id (`motionKey`), so a
 * list that moves follows it.
 */
export function RecentRow({
  tasks,
  task,
  now,
  face = true,
  unread,
  onOpen,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  now: number;
  /** Whether the row wears who is on it, which a person's own page says once in its head instead. */
  face?: boolean;
  /** Whether it is unread as the sidebar's row counts it: marked so by hand, or saved since the developer last looked (`useUnreadTasks`). */
  unread: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
  });
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
  }, []);
  const endedByKey = useRefocusAfterEdit(rename.editing, row);
  const worn = face ? assigneeFace(task, directory) : undefined;
  const card = useMemo(() => taskCardOf(tasks, task, now), [tasks, task, now]);
  return (
    <>
      <RowHintOptions card={card} cardBeside>
        <ListRow
          ref={hold}
          motionKey={task.id}
          leading={<PlanGlyph status={task.status} />}
          title={
            rename.editing ? (
              <InlineEdit
                value={rename.asked ?? task.name}
                label="Task name"
                maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                editing
                onEnd={(edit) => {
                  endedByKey(edit.byKey);
                  rename.end(edit.value);
                }}
              />
            ) : (
              task.name
            )
          }
          description={rename.refused ? <span>{RENAME_FAILED_NOTE}</span> : undefined}
          meta={
            rename.editing ? null : (
              <span className="home-row-meta">
                <OneLine className="home-row-context" words={task.repository ?? "No repository"}>
                  {task.repository ?? "No repository"}
                </OneLine>
                {worn === undefined ? null : <AssigneeFaceMark face={worn} />}
                <TaskRowMark task={task} stranded={strandedHome(tasks, task)} />
                <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />
              </span>
            )
          }
          unread={unread}
          disabled={actions.deletion.busy}
          hint={rename.editing ? undefined : { Hint: RowHint, label: task.name }}
          onPress={rename.editing ? undefined : onOpen}
          menu={
            rename.editing
              ? undefined
              : { ...rowMenu("Task", actions.groups(), tasks.shown), footer: actions.footer }
          }
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}
