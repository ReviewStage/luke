import type { ReactNode } from "react";
import { MessageAction, MessageActions } from "../ai-elements/message";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback";

/**
 * copy-message.tsx -- the one action under a transcript's message: a copy of its words to the clipboard.
 *
 * A thin wrapper over AI Elements' message actions, shared by the voice
 * Call tab and a coding agent's tab, answered as every copy button
 * in the window is (`copy-feedback.tsx`): the glyph turns to a check for a
 * moment and back, and the button's name stays "Copy".
 */

/** What the action is called, which is its accessible name and its hint. */
const COPY_LABEL = "Copy";

export function CopyMessageAction({
  words,
  className,
}: {
  words: string;
  className?: string;
}): ReactNode {
  const { state, copy } = useCopyFeedback();
  return (
    <MessageActions className={className}>
      <MessageAction
        label={COPY_LABEL}
        tooltip={copyHint(state, COPY_LABEL)}
        className="[&_svg]:size-4"
        onClick={() => copy(words)}
      >
        <CopyGlyph state={state} />
      </MessageAction>
    </MessageActions>
  );
}
