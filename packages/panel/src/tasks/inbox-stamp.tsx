import { BADGE_TONE, Badge, CHIP_LOOK, CHIP_SIZE, CHIP_TONE, Chip } from "@luke/ui";
import { CheckIcon, Undo2Icon } from "lucide-react";
import { ANSWER_TONE, type AnswerStamp } from "./inbox-model.js";

/**
 * inbox-stamp.tsx -- an answer to an Inbox ask as a stamp: its glyph and its words, at the head of the reply that sent it or over the box it is attached to.
 *
 * A stamp is a `Badge`, or a removable `Chip` where it is attached, and the
 * only colour it spends is its glyph's: a check in green for an answer that
 * goes ahead, and a turn back in red for one that holds back, so Approved
 * and Requested changes read apart at a glance. Attached to the box, it
 * carries a × that takes it off again.
 */

/** What the × on an attached stamp says it does. */
const TAKE_OFF = "Take off answer";

export function InboxStamp({
  stamp,
  onRemove,
}: {
  stamp: AnswerStamp;
  /** Takes the answer off the box, where the stamp is attached rather than sent. */
  onRemove?: (() => void) | undefined;
}): React.JSX.Element {
  const ahead = stamp.tone === ANSWER_TONE.AHEAD;
  const glyph = ahead ? <CheckIcon aria-hidden="true" /> : <Undo2Icon aria-hidden="true" />;
  return (
    <span className="inbox-stamp" data-inbox-stamp="" data-tone={stamp.tone}>
      {onRemove === undefined ? (
        <Badge tone={ahead ? BADGE_TONE.COMPLETE : BADGE_TONE.DANGER} icon={glyph}>
          {stamp.words}
        </Badge>
      ) : (
        <Chip
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          tone={ahead ? CHIP_TONE.COMPLETE : CHIP_TONE.DANGER}
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
