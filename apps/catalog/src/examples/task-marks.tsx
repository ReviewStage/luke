import { TASK_PRIORITY, TASK_STATUS } from "@luke/features/task-wire";
import { GAP, Inline, TaskPriorityMark, TaskStatusMark, TEXT_VARIANT, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * task-marks.tsx -- a task's status as its mark, each of the five, and its
 * priority as its mark, each of the five, every one beside the word it stands for.
 */

function TaskMarks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="task-status-mark" title="A task's status">
        <Inline gap={GAP.SECTION}>
          {Object.values(TASK_STATUS).map((status) => (
            <Inline key={status} gap={GAP.CONTROL}>
              <TaskStatusMark status={status} />
              <Text variant={TEXT_VARIANT.CAPTION}>{status}</Text>
            </Inline>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="task-priority-mark" title="A task's priority">
        <Inline gap={GAP.SECTION}>
          {Object.values(TASK_PRIORITY).map((priority) => (
            <Inline key={priority} gap={GAP.CONTROL}>
              <TaskPriorityMark priority={priority} />
              <Text variant={TEXT_VARIANT.CAPTION}>{priority}</Text>
            </Inline>
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const TASK_MARKS_EXAMPLE: Example = {
  id: "task-marks",
  title: "Task marks",
  Render: TaskMarks,
};
