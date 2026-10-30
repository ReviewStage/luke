import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  type Task,
  type TaskBlockRelation,
  type TaskBlockRequest,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  GAP,
  Inline,
  LinkIcon,
  type MenuRow,
  POPOVER_ALIGN,
  SearchableMenu,
  Stack,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useId, useRef, useState } from "react";

/**
 * task-blocks.tsx -- a task's blocks under its standing chips: the tasks it waits on and the tasks that wait on it, each a pill that opens its task, and the chip that adds one.
 *
 * A block is Linear's blocked-by and blocks: advice that one task waits on
 * another's work, which nothing refuses to start. The head stays quiet while
 * a task has none, its standing chips ending in Add relation, a link's mark
 * alone, whose menu asks which side first, Blocked by or Blocks, then lists
 * the workspace's other tasks by name and key, searched, those already on
 * that side left out. A task with blocks draws a line for each side that
 * holds any, its words muted ahead of a pill per task, by its status mark
 * and name, which opens it and whose × takes the block away. A task the
 * window does not list yet is named "Task" until it does. Without a door to
 * send a change, as on an archived task, the pills only open and no chip
 * adds one; the service's answer is what the lines go on drawing.
 */

/** Each side of a block as its line, its menu's row, and a pill's × name it. */
export const TASK_BLOCK_WORDS = {
  [TASK_BLOCK_RELATION.BLOCKED_BY]: "Blocked by",
  [TASK_BLOCK_RELATION.BLOCKS]: "Blocks",
} as const satisfies Record<TaskBlockRelation, string>;

/** The sides in the order the lines and the menu stand them. */
const RELATION_ORDER: readonly TaskBlockRelation[] = [
  TASK_BLOCK_RELATION.BLOCKED_BY,
  TASK_BLOCK_RELATION.BLOCKS,
];

/** The add menu's first rows: which side the task picked next stands on. */
const RELATION_ROWS: readonly MenuRow[] = RELATION_ORDER.map((relation) => ({
  id: relation,
  label: TASK_BLOCK_WORDS[relation],
}));

/** What a task the window does not list yet is called on its pill. */
const UNLISTED_TASK_NAME = "Task";

/** What the page hands a task's blocks: the workspace's name, which a key is drawn from, its tasks, which name a pill and fill the menu, where a press on one opens it, and where a change is sent, none where the task takes none. */
export interface TaskBlocksDoor {
  readonly workspaceName: string;
  readonly tasks: readonly TaskSummary[];
  readonly onOpen: (taskId: string) => void;
  readonly onChange?: ((change: TaskBlockRequest) => void) | undefined;
}

/** The side a picked row names; none for a row that names none. */
function relationOf(id: string): TaskBlockRelation | undefined {
  return RELATION_ORDER.find((relation) => relation === id);
}

/** The task's blocks on one side, by id; none from a service before blocks. */
function sideOf(task: Task, relation: TaskBlockRelation): readonly string[] {
  return (relation === TASK_BLOCK_RELATION.BLOCKED_BY ? task.blockedBy : task.blocks) ?? [];
}

/**
 * The tasks the menu offers for a side: the workspace's others, by name,
 * their status mark, and their key, which a search matches too, leaving out
 * the task itself and those already on that side.
 */
function candidateRows(
  task: Task,
  tasks: readonly TaskSummary[],
  relation: TaskBlockRelation,
  workspaceName: string,
): readonly MenuRow[] {
  const standing = new Set(sideOf(task, relation));
  return tasks
    .filter((each) => each.id !== task.id && !standing.has(each.id))
    .map((each) => {
      const key = each.number === undefined ? undefined : taskKey(workspaceName, each.number);
      return {
        id: each.id,
        label: each.name,
        ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
        ...(key === undefined ? {} : { detail: key, terms: [key] }),
      };
    });
}

/**
 * Add relation: a link's mark alone, quiet until the pointer is on it,
 * dropping the shared menu, which asks the side first and then lists the
 * tasks for it, searched; a pick of a task is handed to `onChange` as the
 * block added. Closing the menu forgets the side.
 */
export function TaskBlockAdd({
  task,
  door,
  onChange,
}: {
  task: Task;
  door: TaskBlocksDoor;
  onChange: (change: TaskBlockRequest) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState<TaskBlockRelation | undefined>(undefined);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const row = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  // Note that we hand focus back to the chip, as a native menu returns it to its button, because closing takes the focused menu away.
  const close = () => {
    setOpen(false);
    setRelation(undefined);
    chip.current?.focus();
  };
  const pick = (id: string) => {
    if (relation === undefined) {
      setRelation(relationOf(id));
      return;
    }
    close();
    onChange({ change: TASK_BLOCK_CHANGE.ADD, relation, taskId: id });
  };
  return (
    <span className="task-block-add relative inline-flex items-center" ref={row}>
      <Tooltip label={open ? undefined : "Add relation"}>
        <Chip
          ref={chip}
          look={CHIP_LOOK.TOOLBAR}
          iconOnly
          aria-label="Add relation"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <LinkIcon />
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <SearchableMenu
          // Keyed by the side, so the task list opens on its own search, and the side's choice on none.
          key={relation ?? "side"}
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={relation === undefined ? "Add relation" : TASK_BLOCK_WORDS[relation]}
          placeholder={relation === undefined ? undefined : "Find a task…"}
          rows={
            relation === undefined
              ? RELATION_ROWS
              : candidateRows(task, door.tasks, relation, door.workspaceName)
          }
          value={undefined}
          noMatch="No tasks match"
          align={POPOVER_ALIGN.START}
          onPick={pick}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && row.current?.contains(left))) close();
          }}
        />
      ) : null}
    </span>
  );
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
