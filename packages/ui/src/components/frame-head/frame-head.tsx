import type { TaskStatus } from "@luke/features/task-wire";
import type { ReactNode, RefObject } from "react";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";

/**
 * frame-head.tsx -- the head of the frame a task stands in, as a workspace heads a window: the task named by its path, as Luke draws a task, which stays on screen whatever is chosen under it.
 *
 * A task frames its column the way a workspace frames a window in an editor:
 * whichever of its views is chosen under it, this head names the task, so
 * the reader always knows which task they are in. It is one path of quiet
 * presses (`Breadcrumbs`' `CONTROL` look), each press lit only under the
 * pointer and outlined never:
 *
 * - the task's repository, where the page hands its crumb: plain words with
 *   its mark, never a press, since the head only names where the task is;
 * - the tasks it is a child of, eldest first, each a press that opens it,
 *   the path folding the eldest into one "…" before it cuts a name short;
 * - the task itself, last and current, a press that opens it.
 *
 * A task is drawn as ⌘K's row draws one: its status mark, its name, and its
 * key (`ACME-42`) muted after it, kept whole while the name gives way.
 * Where the task stands beyond its mark, its assignee and the rest, is the
 * plan's head's to say and change, not this one's. Nothing here carries the
 * name in an attribute, so session replay, which masks words and not
 * attributes, still records only the layout.
 *
 * While the task is read, `FrameHeadSkeleton` stands in the same row
 * through the same frame, one control's block where the task's crumb will
 * be, so the head lands without a jump. The head starts on its frame's
 * edge, as the tabs over it do; it owns its band's inset and no room around
 * it, and takes no class or style.
 */

/** A task as its head names it: its status mark, its name, and its key, a press that opens it, and the card its hint hangs. */
export interface FrameHeadTask {
  readonly name: string;
  /** The task's key (`ACME-42`); none for a task from a service before keys. */
  readonly taskKey?: string | undefined;
  /** Where it stands, drawn as its mark; none for a task from a service before statuses. */
  readonly status?: TaskStatus | undefined;
  readonly onOpen: () => void;
  /** The task's card, hung in its hint's place; none where the page hangs none. */
  readonly card?: ReactNode;
}

/** What the task's path is named for a reader moving between landmarks. */
const PATH_LABEL = "Task path";

/** How wide the task's crumb's block stands while the task is read: a settings row's field, about a short name and a task's key. */
const CRUMB_SKELETON_WIDTH = "var(--luke-select-field-width)";

/** The head's band: the task's path on its frame's edge. */
function FrameHeadFrame({
  named,
  room,
}: {
  /** The task's path, or its block while the task is read. */
  named: ReactNode;
  /** The box a crumb's menu hangs from, which holds the path. */
  room?: RefObject<HTMLDivElement | null> | undefined;
}): React.JSX.Element {
  return (
    <header className="luke-frame-head">
      <div className="luke-frame-head-named" ref={room}>
        {named}
      </div>
    </header>
  );
}

/** A task's crumb: its status mark, its name, its key after it, and its press. */
function taskCrumb(task: FrameHeadTask, current: boolean): Crumb {
  return {
    label: task.name,
    glyph: task.status === undefined ? undefined : <TaskStatusMark status={task.status} />,
    detail: task.taskKey,
    card: task.card,
    current,
    onPress: task.onOpen,
  };
}

/**
 * A task's head: its path, its repository's crumb where the page hands one,
 * the tasks it is a child of, and the task itself, each task a press that
 * opens it. Something the page opens beside the head, the repository's menu
 * where ⌘K asks for it, hangs from the head's own box (`room`, `menu`),
 * since the path clips what stands inside it.
 */
export function FrameHead({
  repository,
  ancestors = [],
  task,
  room,
  menu,
}: {
  /** The repository's crumb, words with no press; none where the page hands none. */
  repository?: Crumb | undefined;
  /** The tasks the task is a child of, eldest first. */
  ancestors?: readonly FrameHeadTask[];
  task: FrameHeadTask;
  /** The box a menu the page opens beside the path hangs from. */
  room?: RefObject<HTMLDivElement | null> | undefined;
  /** What the page opens beside the path, drawn in `room`. */
  menu?: ReactNode;
}): React.JSX.Element {
  const crumbs = [
    ...(repository === undefined ? [] : [repository]),
    ...ancestors.map((each) => taskCrumb(each, false)),
    taskCrumb(task, true),
  ];
  return (
    <FrameHeadFrame
      room={room}
      named={
        <>
          <Breadcrumbs label={PATH_LABEL} variant={BREADCRUMBS_VARIANT.CONTROL} crumbs={crumbs} />
          {menu}
        </>
      }
    />
  );
}

/** The head while its task is read: one control's block where the task's crumb will be. */
export function FrameHeadSkeleton(): React.JSX.Element {
  return (
    <FrameHeadFrame
      named={<Skeleton shape={SKELETON_SHAPE.CONTROL} width={CRUMB_SKELETON_WIDTH} />}
    />
  );
}
