import type { TaskSummary } from "@luke/features/task-wire";
import { ListRow, OneLine, RowHint, RowHintOptions, Time } from "@luke/ui";
import { assigneeFace } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { useMemo } from "react";
import { AssigneeFaceMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { PlanGlyph } from "../tasks/tab-look.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { strandedHome } from "./move-task-dialog.js";
import { TaskRowMark, taskCardOf } from "./task-card.js";

/**
 * recent-row.tsx -- a plan as a person's page lists it: its glyph, the name, and at its end the repository, who is on it, and its mark and time, hanging its card.
 */

/**
 * A plan as a `ListRow`, read as its sidebar row reads it: led by its glyph
 * (`PlanGlyph`), the name, and at its end the repository, the face of who
 * is on it (`assigneeFace`): a teammate's where they are assigned, the
 * dashed unassigned mark where no one is, and none where the reader is;
 * then its row's mark and time. Who made it is never its face, and stays on
 * its card (`taskCardOf`), which it hangs beside it while the pointer rests
 * on it.
 */
export function RecentRow({
  tasks,
  task,
  now,
  face = true,
  onOpen,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  now: number;
  /** Whether the row wears who is on it, which a person's own page says once in its head instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const worn = face ? assigneeFace(task, directory) : undefined;
  const card = useMemo(() => taskCardOf(tasks, task, now), [tasks, task, now]);
  return (
    <RowHintOptions card={card} cardBeside>
      <ListRow
        leading={<PlanGlyph status={task.status} />}
        title={task.name}
        meta={
          <span className="home-row-meta">
            <OneLine className="home-row-context" words={task.repository ?? "No repository"}>
              {task.repository ?? "No repository"}
            </OneLine>
            {worn === undefined ? null : <AssigneeFaceMark face={worn} />}
            <TaskRowMark task={task} stranded={strandedHome(tasks, task)} />
            <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />
          </span>
        }
        hint={{ Hint: RowHint, label: task.name }}
        onPress={onOpen}
      />
    </RowHintOptions>
  );
}
