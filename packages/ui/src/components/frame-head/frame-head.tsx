import { AttentionMark } from "../attention-mark/attention-mark.js";
import { BUTTON_SHAPE, BUTTON_SIZE, BUTTON_VARIANT, Button } from "../button/button.js";
import { CHIP_LOOK, Chip, ChipName } from "../chip/chip.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";

/**
 * frame-head.tsx -- the head of the frame a task stands in, as a workspace heads a window: the task named as a chip, and what waits on the reader there, which stay on screen whatever is chosen under it.
 *
 * A task frames its column the way a workspace frames a window in an editor:
 * whichever of its views is chosen under it, this head names the task, so
 * the reader always knows which task they are in. It is one row:
 *
 * - the task as a chip, its key (`ACME-42`) in the code face before its
 *   name, a press that opens the task itself;
 * - at the row's end, `waiting`'s count, "2 need you", a press that goes
 *   to what waits, said only while something does, since "0 need you" is
 *   no news.
 *
 * Where the task stands, its status, assignee, and the rest, is the plan's
 * head's to say and change, not this one's. Nothing here carries the name
 * in an attribute, so session replay, which masks words and not attributes,
 * still records only the layout.
 *
 * While the task is read, `FrameHeadSkeleton` stands in the same row
 * through the same frame, one control's block where the chip will be, so
 * the head lands without a jump. The head owns its band's inset and no room
 * around it, and takes no class or style.
 */

/** What the count's words say after its figure, by how many wait. */
export interface FrameHeadCountNoun {
  readonly one: string;
  readonly many: string;
}

/** What waits on the reader in the task: how many, the words after the figure, and the press that goes to them. */
export interface FrameHeadWaiting {
  readonly count: number;
  readonly noun: FrameHeadCountNoun;
  readonly onOpen: () => void;
}

/** The task's key in the chip, in the code face as a branch's name is (`ChipName`'s `mono`), but never cut short: the name gives way instead, since the key tells one task from another. */
const KEY = "luke-frame-head-key flex-none font-mono text-caption leading-[inherit]";

/** How wide the chip's block stands while the task is read: a settings row's field, about a task's key and a short name. */
const CHIP_SKELETON_WIDTH = "var(--luke-select-field-width)";

/** A count with its words: "1 needs you", "3 need you". */
function countWords(count: number, noun: FrameHeadCountNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/** The head's band: what names the task, and what stands at the row's end. */
function FrameHeadFrame({
  named,
  end,
}: {
  /** The task's chip, or its block while the task is read. */
  named: React.ReactNode;
  end?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="luke-frame-head">
      <div className="luke-frame-head-named">{named}</div>
      {end}
    </header>
  );
}

/** The count of what waits on the reader, a press that goes to it; nothing while none waits. */
function WaitingCount({
  waiting,
}: {
  waiting: FrameHeadWaiting | undefined;
}): React.JSX.Element | null {
  if (waiting === undefined || waiting.count === 0) return null;
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      shape={BUTTON_SHAPE.ROUND}
      size={BUTTON_SIZE.COMPACT}
      icon={<AttentionMark />}
      onClick={waiting.onOpen}
    >
      {countWords(waiting.count, waiting.noun)}
    </Button>
  );
}

/** A task's head: the task as a chip, which opens it, and what waits on the reader at the row's end. */
export function FrameHead({
  taskKey,
  name,
  onOpen,
  waiting,
}: {
  /** The task's key (`ACME-42`); none for a task from a service before keys. */
  taskKey?: string | undefined;
  /** The task's name. */
  name: string;
  /** Opens the task itself, a press on its chip. */
  onOpen: () => void;
  /** What waits on the reader here, and where a press goes; nothing is said while none waits. */
  waiting?: FrameHeadWaiting | undefined;
}): React.JSX.Element {
  return (
    <FrameHeadFrame
      named={
        <Chip look={CHIP_LOOK.PILL} onClick={onOpen}>
          {taskKey === undefined ? null : <span className={KEY}>{taskKey}</span>}
          <ChipName>{name}</ChipName>
        </Chip>
      }
      end={<WaitingCount waiting={waiting} />}
    />
  );
}

/** The head while its task is read: one control's block where the task's chip will be. */
export function FrameHeadSkeleton(): React.JSX.Element {
  return (
    <FrameHeadFrame
      named={<Skeleton shape={SKELETON_SHAPE.CONTROL} width={CHIP_SKELETON_WIDTH} />}
    />
  );
}
