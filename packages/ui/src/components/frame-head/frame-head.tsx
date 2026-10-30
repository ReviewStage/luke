import type { TaskStatus } from "@luke/features/task-wire";
import type { ReactNode, RefObject } from "react";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { OneLine } from "../one-line/one-line.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import type { ToolbarProps } from "../toolbar/toolbar.js";
import { ToolbarName } from "../toolbar/toolbar-name.js";

/**
 * frame-head.tsx -- the head of the frame a place stands in, as a workspace heads a window: a task named by its path, as Luke draws a task, or any other place named by its words, which stay on screen whatever is chosen under it.
 *
 * A task frames its column the way a workspace frames a window in an editor:
 * whichever of its views is chosen under it, this head names the task, so
 * the reader always knows which task they are in. It is one path of quiet
 * presses (`Breadcrumbs`' `CONTROL` look), each lit only under the pointer
 * and outlined never:
 *
 * - the task's repository, where the page hands its crumb, which drops the
 *   repository's menu the plan's own path drops;
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
 * A place that is no task (the Inbox, an agent's page, Automations) is named
 * by `FramePlace` in the same row, in the words its own bar would name it
 * by (`ToolbarName`): its title, the places above it as crumbs, each a press
 * back to its place, and quiet words after it. A title is the page's
 * heading; a name picked up from a page that heads itself is words.
 *
 * While the task is read, `FrameHeadSkeleton` stands in the same row
 * through the same frame, one control's block where the task's crumb will
 * be, so the head lands without a jump. A task's head starts on its frame's
 * edge, as the tabs under it do, and any other place's at its column's
 * inset; the head owns its band's inset and no room around it, and takes no
 * class or style.
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

/** Where a head's first mark stands: its frame's edge, as a task's crumbs do the tabs' under them, a control at its column's inset, or words where its column's words start. */
const FRAME_START = {
  EDGE: "edge",
  CONTROL: "control",
  WORDS: "words",
} as const;

type FrameStart = (typeof FRAME_START)[keyof typeof FRAME_START];

/** What the task's path is named for a reader moving between landmarks. */
const PATH_LABEL = "Task path";

/** Quiet words after a place's name, in the body's type, on one line cut short before the name is. */
const DETAIL = "luke-frame-head-detail min-w-0 flex-[0_1000_auto] text-body text-muted-foreground";

/** How wide the task's crumb's block stands while the task is read: a settings row's field, about a short name and a task's key. */
const CRUMB_SKELETON_WIDTH = "var(--luke-select-field-width)";

/** The head's band: what names the place, standing where `start` says. */
function FrameHeadFrame({
  named,
  start = FRAME_START.CONTROL,
  detailed = false,
  room,
}: {
  /** The task's path, or its block while the task is read, or a place's name. */
  named: ReactNode;
  start?: FrameStart;
  /** Whether quiet words follow the name, on its last baseline. */
  detailed?: boolean;
  /** The box a crumb's menu hangs from, which holds the name. */
  room?: RefObject<HTMLDivElement | null> | undefined;
}): React.JSX.Element {
  return (
    <header className="luke-frame-head" data-start={start} data-detail={detailed ? "" : undefined}>
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
 * opens it. A crumb that drops a menu, the repository's, hangs it from the
 * head's own box (`room`, `menu`), since the path clips what stands inside it.
 */
export function FrameHead({
  repository,
  ancestors = [],
  task,
  room,
  menu,
}: {
  /** The repository's crumb, which drops its menu; none where the page hands none. */
  repository?: Crumb | undefined;
  /** The tasks the task is a child of, eldest first. */
  ancestors?: readonly FrameHeadTask[];
  task: FrameHeadTask;
  /** The box a crumb's menu hangs from. */
  room?: RefObject<HTMLDivElement | null> | undefined;
  /** What a crumb drops, drawn in `room`. */
  menu?: ReactNode;
}): React.JSX.Element {
  const crumbs = [
    ...(repository === undefined ? [] : [repository]),
    ...ancestors.map((each) => taskCrumb(each, false)),
    taskCrumb(task, true),
  ];
  return (
    <FrameHeadFrame
      start={FRAME_START.EDGE}
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

/** A place's head that is no task: its name as its own bar would say it, and quiet words after it. */
export function FramePlace({
  title,
  trail,
  pickUp,
  detail,
}: Pick<ToolbarProps, "title" | "trail" | "pickUp" | "detail">): React.JSX.Element {
  const detailed = detail !== undefined && detail !== null && detail !== false && detail !== "";
  return (
    <FrameHeadFrame
      start={trail === undefined || trail.length === 0 ? FRAME_START.WORDS : FRAME_START.CONTROL}
      detailed={detailed}
      named={
        <>
          <ToolbarName title={title} trail={trail} pickUp={pickUp} />
          {detailed ? <OneLine className={DETAIL}>{detail}</OneLine> : null}
        </>
      }
    />
  );
}

/** The head while its task is read: one control's block where the task's crumb will be. */
export function FrameHeadSkeleton(): React.JSX.Element {
  return (
    <FrameHeadFrame
      start={FRAME_START.EDGE}
      named={<Skeleton shape={SKELETON_SHAPE.CONTROL} width={CRUMB_SKELETON_WIDTH} />}
    />
  );
}
