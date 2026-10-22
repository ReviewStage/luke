import { BUTTON_SIZE, IconButton } from "@luke/ui";
import { CheckIcon, Undo2Icon, XIcon } from "lucide-react";
import { ANSWER_TONE, type AnswerStamp } from "./inbox-model.js";

/**
 * inbox-stamp.tsx -- an answer to an Inbox ask as a stamp: its glyph and its words, at the head of the reply that sent it or over the box it is attached to.
 *
 * A stamp is a chip of the strong fill in the thread's own ink, and the
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
  return (
    <span className="inbox-stamp" data-inbox-stamp="" data-tone={stamp.tone}>
      {stamp.tone === ANSWER_TONE.AHEAD ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <Undo2Icon aria-hidden="true" />
      )}
      <span className="inbox-stamp-words">{stamp.words}</span>
      {onRemove === undefined ? null : (
        <IconButton
          icon={<XIcon />}
          label={TAKE_OFF}
          size={BUTTON_SIZE.COMPACT}
          onClick={onRemove}
        />
      )}
    </span>
  );
}
