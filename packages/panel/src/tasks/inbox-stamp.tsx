import { Badge, CHIP_LOOK, CHIP_SIZE, Chip, STATUS_TONE, type StatusTone } from "@luke/ui";
import { CheckIcon, Undo2Icon } from "@luke/ui/icons";
import { ANSWER_TONE, type AnswerStamp, type AnswerTone } from "./inbox-model.js";

/**
 * inbox-stamp.tsx -- an answer to an Inbox ask as a stamp: its glyph and its words, at the head of the reply that sent it or over the box it is attached to.
 *
 * A stamp is a `Badge`, or a removable `Chip` where it is attached, and the
 * only colour it spends is its glyph's: a check in green for an answer that
 * goes ahead, and a turn back in the neutral grey for one that holds back,
 * since holding back failed nothing, so Approved and Changes requested read
 * apart at a glance. Attached to the box, it carries a × that takes it off
 * again.
 */

/** What the × on an attached stamp says it does. */
const TAKE_OFF = "Take off answer";

/** The status tone each way an answer goes is drawn in: going ahead complete, holding back neutral. */
export const ANSWER_STATUS_TONE = {
  [ANSWER_TONE.AHEAD]: STATUS_TONE.COMPLETE,
  [ANSWER_TONE.BACK]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<AnswerTone, StatusTone>;

export function InboxStamp({
  stamp,
  onRemove,
}: {
  stamp: AnswerStamp;
  /** Takes the answer off the box, where the stamp is attached rather than sent. */
  onRemove?: (() => void) | undefined;
}): React.JSX.Element {
  const tone = ANSWER_STATUS_TONE[stamp.tone];
  const glyph =
    stamp.tone === ANSWER_TONE.AHEAD ? (
      <CheckIcon aria-hidden="true" />
    ) : (
      <Undo2Icon aria-hidden="true" />
    );
  return (
    <span
      className="inbox-stamp inline-flex max-w-full self-start"
      data-inbox-stamp=""
      data-answer={stamp.tone}
    >
      {onRemove === undefined ? (
        <Badge tone={tone} icon={glyph}>
          {stamp.words}
        </Badge>
      ) : (
        <Chip
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          tone={tone}
          onRemove={onRemove}
          removeLabel={TAKE_OFF}
        >
          {glyph}
          {stamp.words}
        </Chip>
      )}
    </span>
  );
}
