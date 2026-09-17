import { EllipsisIcon } from "@sidecar/panel";
import { useId, useState } from "react";

/** What the ellipsis is called for a reader; the glyph alone speaks to the sighted. */
const BUTTON_LABEL = "More";

/** What the sheet is called for a reader, as the group of controls it is. */
const MENU_LABEL = "Message options";

/**
 * The attribute the sheet wears while it stands open, for a row that has to
 * know before the platform has closed it: a search result's press reads it
 * at the pointer's fall, since the light dismiss lands on the pointer's lift
 * and the click after that would otherwise be read as the words' own.
 */
export const CONVERSATION_MENU_OPEN_ATTRIBUTE = "data-open";

/**
 * The ellipsis beside one of Luke's messages, to the right of its copy
 * control, and the sheet it opens: the controls a message carries that are
 * not worth a glyph each in its margin — the thumbs, and whatever a verdict
 * stands beside them. It is the platform's own popover, so it opens in the
 * top layer clear of the thread's two scrollers, closes itself on a press
 * outside or on Escape, and anchors to the button that opened it without a
 * line of positioning here; the button's expanded state is the platform's
 * too. What it holds is rendered whether or not it is open, only shown when
 * it is, so a press still in flight inside it, or the refusal the last one
 * met, survives the sheet closing. It is a descendant of the Conversation
 * subtree in the document however it is drawn, so the session recording that
 * blocks the subtree blocks it with the words it stands beside. Whether it
 * stands open is the platform's word, read back from its toggle and worn as
 * an attribute for the one row that has to ask.
 */
export function ConversationMessageMenu({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="conversation-more">
      <button
        type="button"
        className="conversation-more-button"
        aria-label={BUTTON_LABEL}
        popoverTarget={id}
      >
        <EllipsisIcon />
      </button>
      <fieldset
        id={id}
        className="conversation-menu"
        popover="auto"
        aria-label={MENU_LABEL}
        onToggle={(event) => setOpen(event.newState === "open")}
        {...(open ? { [CONVERSATION_MENU_OPEN_ATTRIBUTE]: "true" } : undefined)}
      >
        {children}
      </fieldset>
    </span>
  );
}
