import { LinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MessageAction, MessageActions } from "../ai-elements/message";
import { CopyGlyph, copyHint, LINK_COPY, useCopyFeedback } from "../copy-feedback";
import { useCopyLink } from "../copy-link-item";
import { useMessagePlace } from "./message-links";

/**
 * copy-message.tsx -- the actions under a transcript's message: a copy of its words to the clipboard, and, where its transcript names its messages, Copy link.
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
  messageId,
  className,
}: {
  words: string;
  /** The message's id, by which its transcript names it for its Copy link; none where it has no link. */
  messageId?: string | undefined;
  className?: string;
}): ReactNode {
  const { state, copy } = useCopyFeedback();
  const place = useMessagePlace(messageId ?? "");
  const copyLink = useCopyLink();
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
      {messageId === undefined || place === undefined || copyLink === undefined ? null : (
        <MessageAction
          label={LINK_COPY.LABEL}
          tooltip={LINK_COPY.LABEL}
          className="[&_svg]:size-4"
          onClick={() => copyLink(place)}
        >
          <LinkIcon />
        </MessageAction>
      )}
    </MessageActions>
  );
}
