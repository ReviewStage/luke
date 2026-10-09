import { CheckIcon, CopyIcon } from "lucide-react";
import { type FocusEvent, type ReactNode, useRef, useState } from "react";
import { MessageAction, MessageActions } from "../ai-elements/message";

/**
 * copy-message.tsx -- the one action under a transcript's message: a copy of its words to the clipboard.
 *
 * A thin wrapper over AI Elements' message actions, shared by the voice
 * Transcript tab and a coding agent's tab. The copy is done by whoever
 * holds the clipboard, handed in as `copyText`, which on the desktop is
 * main's own (`ACT_KIND.WINDOW_COPY_TEXT`); the check mark stands while
 * the pointer or the keyboard stays on the bar, so a press is answered
 * where it was made and the button is itself again the next time the
 * message is read, with no clock to arm for it. A copy that lands after
 * the reader has already left the bar shows nothing, because a mark
 * standing on a bar nobody is on would say "copied" to the next reader
 * about a press that was not theirs. A clipboard that refused the copy
 * leaves the button as it was, because a mark that stood for nothing would
 * be worse than none.
 */

/** What the action is called, which is its accessible name and its hint. */
const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";

export function CopyMessageAction({
  words,
  copyText,
  className,
}: {
  words: string;
  copyText: (words: string) => Promise<void>;
  className?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  // Note that this is a ref, because a copy still out when the reader leaves
  // reads it as it settles, which no render stands between.
  const left = useRef(true);
  const arrive = () => {
    left.current = false;
  };
  const leave = () => {
    left.current = true;
    setCopied(false);
  };
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    // Focus moving between the bar's own buttons is not a leaving.
    if (!event.currentTarget.contains(event.relatedTarget)) leave();
  };
  return (
    <MessageActions
      className={className}
      onPointerEnter={arrive}
      onPointerLeave={leave}
      onFocus={arrive}
      onBlur={blur}
    >
      <MessageAction
        label={copied ? COPIED_LABEL : COPY_LABEL}
        tooltip
        data-copied={copied ? "true" : undefined}
        onClick={() => {
          arrive();
          copyText(words).then(
            () => {
              if (!left.current) setCopied(true);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </MessageAction>
    </MessageActions>
  );
}
