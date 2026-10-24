import { BUTTON_SIZE, CopyButton, MessageActions } from "@luke/ui";
import { LinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { copyThroughShell, LINK_COPY } from "../copy-feedback.js";
import { useCopyLink } from "../copy-link-item.js";
import { ForkMessageAction } from "./fork-action.js";
import type { ForkCut } from "./fork-model.js";
import { useMessagePlace } from "./message-links.js";
import {
  EditMessageAction,
  REWIND_ACTION,
  RevertMessageAction,
  type RewindAction,
} from "./rewind-action.js";

/**
 * copy-message.tsx -- the actions under a transcript's message: a copy of its words to the clipboard, where its transcript names its messages Copy link, on an agent's own message where its tab offers it, Fork to new agent (`fork-action.tsx`), and, where its tab offers a rewind, a line's Edit or a reply's Revert to here (`rewind-action.tsx`).
 *
 * A thin wrapper over AI Elements' message actions, shared by every
 * transcript's messages, whose Copy is `@luke/ui`'s, answered as every copy
 * button in the window is: the glyph turns to a check for a moment and back.
 */

/** What its Copy copies, which `CopyButton` names ("Copy message"). */
const COPY_WHAT = "message";

export function CopyMessageAction({
  words,
  copyable = true,
  messageId,
  forkable = false,
  forkCut,
  lead,
  rewind,
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
  /** An action of the message's own set before Copy, as a chat notice's Open in Chat is. */
  lead?: ReactNode;
  /** How its tab may offer to rewind to it: Edit on a line of the developer's, Revert to here on the agent's own; none where it offers neither. */
  rewind?: RewindAction | undefined;
}): ReactNode {
  const place = useMessagePlace(messageId ?? "");
  const copyLink = useCopyLink();
  return (
    <MessageActions>
      {lead}
      {copyable ? (
        <CopyButton
          text={words}
          what={COPY_WHAT}
          copy={copyThroughShell}
          size={BUTTON_SIZE.COMPACT}
        />
      ) : null}
      {messageId === undefined || place === undefined || copyLink === undefined ? null : (
        <MessageAction
          label={LINK_COPY.LABEL}
          tooltip={LINK_COPY.LABEL}
          onClick={() => copyLink(place)}
        >
          <LinkIcon />
        </MessageAction>
      )}
      {!forkable || messageId === undefined ? null : (
        <ForkMessageAction messageId={messageId} words={words} cut={forkCut} />
      )}
      {rewind === undefined || messageId === undefined ? null : rewind === REWIND_ACTION.REVERT ? (
        <RevertMessageAction messageId={messageId} />
      ) : (
        <EditMessageAction messageId={messageId} />
      )}
    </MessageActions>
  );
}
