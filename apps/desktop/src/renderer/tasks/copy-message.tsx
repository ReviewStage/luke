import { LinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MessageAction, MessageActions } from "../ai-elements/message";
import { CopyGlyph, copyHint, LINK_COPY, useCopyFeedback } from "../copy-feedback";
import { useCopyLink } from "../copy-link-item";
import { ForkMessageAction } from "./fork-action";
import type { ForkCut } from "./fork-model";
import { useMessagePlace } from "./message-links";

/**
 * copy-message.tsx -- the actions under a transcript's message: a copy of its words to the clipboard, where its transcript names its messages Copy link, and, on an agent's own message where its tab offers it, Fork to new agent (`fork-action.tsx`).
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
  copyable = true,
  messageId,
  forkable = false,
  forkCut,
  className,
}: {
  words: string;
  /** Whether its words are whole and there are any, which its Copy needs; a turn still running, or one with no words, is offered no Copy. */
  copyable?: boolean;
  /** The message's id, by which its transcript names it for its Copy link; none where it has no link. */
  messageId?: string | undefined;
  /** Whether the message is the agent's own, which its tab may offer to fork. */
  forkable?: boolean;
  /** Where its fork cuts it, where it is a reply still being written; none where a fork keeps it whole. */
  forkCut?: ForkCut | undefined;
  className?: string;
}): ReactNode {
  const { state, copy } = useCopyFeedback();
  const place = useMessagePlace(messageId ?? "");
  const copyLink = useCopyLink();
  return (
    <MessageActions className={className}>
      {copyable ? (
        <MessageAction
          label={COPY_LABEL}
          tooltip={copyHint(state, COPY_LABEL)}
          className="[&_svg]:size-4"
          onClick={() => copy(words)}
        >
          <CopyGlyph state={state} />
        </MessageAction>
      ) : null}
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
      {!forkable || messageId === undefined ? null : (
        <ForkMessageAction messageId={messageId} words={words} cut={forkCut} />
      )}
    </MessageActions>
  );
}
