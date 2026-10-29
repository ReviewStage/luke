import { TASK_STATUS, type Task, type TaskSummary } from "@luke/features/task-wire";
import {
  BANNER_LOOK,
  Banner,
  LIST_VARIANT,
  List,
  ListRow,
  STATUS_TONE,
  TaskStatusMark,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { waitingChildTasks } from "../tasks/pilot-breakdown.js";
import { runningSwitchOf } from "../tasks/pilot-switches.js";
import { TaskKey } from "../tasks/task-standing.js";

/**
 * plan-breakdown.tsx -- a pilot task's breakdown waiting for Running, at the head of its plan: the child tasks the pilot proposed, under a banner pointing at the switch.
 *
 * It stands only on a pilot tree's top task while its Running switch is off
 * and any of its child tasks waits (`pilot-breakdown.ts`), and goes once
 * Running is on or none waits. Each child is a row of its status, its name,
 * and its key, which opens that task. Switching Running on, on the task's
 * head (`task-standing.tsx`), is what starts their agents; the developer
 * asks for changes in the pilot's composer.
 */

/** What the waiting children's list is named for a reader moving between lists. */
const WAITING_LIST = "Child tasks waiting to start";

/** What the banner says of the breakdown waiting. */
function waitingWords(count: number): string {
  return count === 1
    ? "The pilot proposed a child task. Switch on Running to start its agent."
    : `The pilot proposed ${String(count)} child tasks. Switch on Running to start their agents.`;
}

/**
 * The child tasks of `task` waiting for its Running switch, under a banner
 * that points at it; nothing but on a pilot tree's top task while Running is
 * off and a child waits. `onOpenTask` opens a child as its row is pressed.
 */
export function PlanBreakdown({
  task,
  tasks,
  workspaceName,
  onOpenTask,
}: {
  task: Pick<Task, "id" | "mode" | "parentTaskId" | "running">;
  /** Every task the window lists, among which the children are found. */
  tasks: readonly TaskSummary[];
  workspaceName: string;
  onOpenTask: (taskId: string) => void;
}): React.JSX.Element | null {
  if (runningSwitchOf(task) !== false) return null;
  const waiting = waitingChildTasks(task, tasks);
  if (waiting.length === 0) return null;
  return (
    <div className="plan-breakdown mb-block-gap flex flex-col gap-block-gap">
      <Banner look={BANNER_LOOK.CARD} tone={STATUS_TONE.ATTENTION} glyph={<GLYPH.TODOS />}>
        {waitingWords(waiting.length)}
      </Banner>
      <List label={WAITING_LIST} variant={LIST_VARIANT.CARD} moves>
        {waiting.map((child) => (
          <ListRow
            key={child.id}
            motionKey={child.id}
            leading={<TaskStatusMark status={TASK_STATUS.TODO} />}
            title={child.name}
            meta={<TaskKey workspaceName={workspaceName} number={child.number} />}
            onPress={() => onOpenTask(child.id)}
          />
        ))}
      </List>
    </div>
  );
}
