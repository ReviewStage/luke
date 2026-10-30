import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  type Task,
  type TaskBlockRelation,
  type TaskBlockRequest,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  GAP,
  Inline,
  Stack,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";

/**
 * task-blocks.tsx -- a task's blocks under its standing chips: the tasks it waits on and the tasks that wait on it, each a pill that opens its task.
 *
 * A block is Linear's blocked-by and blocks: advice that one task waits on
 * another's work, which nothing refuses to start. The head stays quiet while
 * a task has none. A task with blocks draws a line for each side that holds
 * any, its words muted ahead of a pill per task, by its status mark and
 * name, which opens it and whose × takes the block away. A task the window
 * does not list yet is named "Task" until it does. Without a door to send a
 * change, as on an archived task, the pills only open; the service's answer
 * is what the lines go on drawing.
 */

/** Each side of a block as its line and a pill's × name it. */
export const TASK_BLOCK_WORDS = {
  [TASK_BLOCK_RELATION.BLOCKED_BY]: "Blocked by",
  [TASK_BLOCK_RELATION.BLOCKS]: "Blocks",
} as const satisfies Record<TaskBlockRelation, string>;

/** The sides in the order the lines stand them. */
const RELATION_ORDER: readonly TaskBlockRelation[] = [
  TASK_BLOCK_RELATION.BLOCKED_BY,
  TASK_BLOCK_RELATION.BLOCKS,
];

/** What a task the window does not list yet is called on its pill. */
const UNLISTED_TASK_NAME = "Task";

/** What the page hands a task's blocks: the workspace's name, which a key is drawn from, its tasks, which name a pill, where a press on one opens it, and where a change is sent, none where the task takes none. */
export interface TaskBlocksDoor {
  readonly workspaceName: string;
  readonly tasks: readonly TaskSummary[];
  readonly onOpen: (taskId: string) => void;
  readonly onChange?: ((change: TaskBlockRequest) => void) | undefined;
}

/** The task's blocks on one side, by id; none from a service before blocks. */
function sideOf(task: Task, relation: TaskBlockRelation): readonly string[] {
  return (relation === TASK_BLOCK_RELATION.BLOCKED_BY ? task.blockedBy : task.blocks) ?? [];
}

/** One task on a side: a pill by its status mark and name that opens it, with a × taking the block away where a change can be sent. */
function TaskBlockPill({
  taskId,
  relation,
  door,
}: {
  taskId: string;
  relation: TaskBlockRelation;
  door: TaskBlocksDoor;
}): React.JSX.Element {
  const listed = door.tasks.find((each) => each.id === taskId);
  const name = listed?.name ?? UNLISTED_TASK_NAME;
  const face = (
    <>
      {listed?.status === undefined ? null : <TaskStatusMark status={listed.status} />}
      <ChipName>{name}</ChipName>
    </>
  );
  const { onChange } = door;
  const open = () => door.onOpen(taskId);
  if (onChange === undefined) {
    return (
      <Chip look={CHIP_LOOK.PILL} aria-label={`Open ${name}`} onClick={open}>
        {face}
      </Chip>
    );
  }
  return (
    <Chip
      look={CHIP_LOOK.PILL}
      onOpen={open}
      removeLabel={`Remove ${name} from ${TASK_BLOCK_WORDS[relation]}`}
      onRemove={() => onChange({ change: TASK_BLOCK_CHANGE.REMOVE, relation, taskId })}
    >
      {face}
    </Chip>
  );
}

/** The task's blocks, a line for each side that holds any; nothing for a task with none. */
export function TaskBlockLines({
  task,
  door,
}: {
  task: Task;
  door: TaskBlocksDoor;
}): React.JSX.Element | null {
  const sides = RELATION_ORDER.filter((relation) => sideOf(task, relation).length > 0);
  if (sides.length === 0) return null;
  return (
    <Stack gap={GAP.TIGHT}>
      {sides.map((relation) => (
        <Inline key={relation} gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {TASK_BLOCK_WORDS[relation]}
          </Text>
          {sideOf(task, relation).map((taskId) => (
            <TaskBlockPill key={taskId} taskId={taskId} relation={relation} door={door} />
          ))}
        </Inline>
      ))}
    </Stack>
  );
}
