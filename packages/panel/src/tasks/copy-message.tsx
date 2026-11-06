import { BUTTON_SIZE, CopyButton, MessageActions } from "@repo/ui";
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
  copyable?: boolean;
  messageId?: string | undefined;
  forkable?: boolean;
  forkCut?: ForkCut | undefined;
  lead?: ReactNode;
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
