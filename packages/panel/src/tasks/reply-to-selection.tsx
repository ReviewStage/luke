import { BUTTON_SIZE, Button, IconButton } from "@luke/ui";
import { replyOf } from "@luke/ui/reply-quote";
import { ReplyIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ComposerQuote } from "../plan-editor/contract.js";
import { Tooltip } from "../tooltip.js";

/**
 * reply-to-selection.tsx -- words selected in an agent's message answered from its message box: Reply over the selection, and the quote block it lays into the box.
 *
 * Every chat that does this, ChatGPT's "Ask ChatGPT" and Claude's Reply,
 * offers a press beside the words once they are selected. Here the press
 * lays them into the message box as a quote block where the caret stands,
 * as email and GitHub let a reply quote what it answers, so a message can
 * answer several points, each under its quote, or several quotes at once.
 * A selection inside an agent's own words, a text part of one of its
 * messages, which wears `REPLY_SCOPE`, never a call's output or a thought
 * beside it, stands Reply over it once the pointer or the keys let it go,
 * and a press hands the words to the box (`AgentComposer`'s `replyDoor`),
 * whose editor lays them in (`insertQuote`), drawn here
 * (`ComposerQuoteView`), and sends them as a Markdown blockquote set apart
 * by a blank line (`@luke/ui/reply-quote`). The press is drawn over the window, not inside
 * the transcript, so the log's own clipping never cuts it, follows the
 * selection as the log scrolls, and goes as the selection does. Note that
 * the press takes no focus and leaves the selection as it was until it is
 * pressed, because a press that took either would end what it answers.
 * An Inbox item's thread offers the same Reply over the agent's part of it,
 * its question's Markdown, its messages, and why it took the item back, and
 * lays the quote into the item's box (`inbox-pane.tsx`,
 * `inbox-answer-box.tsx`).
 */

/** The attribute that marks an agent's own words in a transcript, which a selection inside may be replied to. */
export const REPLY_SCOPE = "data-reply-scope";

const SCOPE_SELECTOR = `[${REPLY_SCOPE}]`;

/** What the presses are called, which are their names and their hints. */
const REPLY_WORDS = {
  REPLY: "Reply",
  REMOVE: "Remove quote",
} as const;

/** How far the press stands off the selection, and the least room it keeps from the window's sides. */
const PRESS_GAP = 6;
const PRESS_MARGIN = 48;

/** The room the press needs over the selection, under which it stands below instead. */
const PRESS_ROOM = 40;

/** A selection Reply answers: its words as the reply, and where the press stands. */
interface Picked {
  readonly reply: string;
  readonly left: number;
  readonly top: number;
  readonly below: boolean;
}

/** The selection inside one agent's words under `scope`, as Reply answers it; nothing for any other. */
function pickedIn(scope: HTMLElement): Picked | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const words = (common instanceof Element ? common : common.parentElement)?.closest(
    SCOPE_SELECTOR,
  );
  if (words === null || words === undefined || !scope.contains(words)) return undefined;
  const reply = replyOf(selection.toString());
  if (reply === "") return undefined;
  const box = range.getBoundingClientRect();
  const below = box.top < PRESS_ROOM;
  const centre = box.left + box.width / 2;
  return {
    reply,
    left: Math.min(Math.max(centre, PRESS_MARGIN), window.innerWidth - PRESS_MARGIN),
    top: below ? box.bottom + PRESS_GAP : box.top - PRESS_GAP,
    below,
  };
}

/**
 * Reply over words selected in an agent's message under `scope`, handing
 * them to `onReply` as pressed; nothing while no such selection stands.
 */
export function ReplyToSelection({
  scope,
  onReply,
}: {
  scope: RefObject<HTMLElement | null>;
  onReply: (reply: string) => void;
}): ReactNode {
  const [picked, setPicked] = useState<Picked | undefined>(undefined);
  const shown = picked !== undefined;

  // A selection is offered once the pointer or the keys let it go, never while it is being drawn.
  useEffect(() => {
    const element = scope.current;
    if (element === null) return undefined;
    const offer = () => setPicked(pickedIn(element));
    element.addEventListener("pointerup", offer);
    element.addEventListener("keyup", offer);
    return () => {
      element.removeEventListener("pointerup", offer);
      element.removeEventListener("keyup", offer);
    };
  }, [scope]);

  // Once offered, the press follows the selection as the log scrolls and goes as it does.
  useEffect(() => {
    const element = scope.current;
    if (!shown || element === null) return undefined;
    const follow = () => setPicked(pickedIn(element));
    document.addEventListener("selectionchange", follow);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("selectionchange", follow);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [scope, shown]);

  if (picked === undefined) return null;
  return createPortal(
    <div
      className="menu-surface reply-to-selection"
      data-below={picked.below ? "" : undefined}
      style={{ left: picked.left, top: picked.top }}
    >
      <Button
        icon={<ReplyIcon aria-hidden="true" />}
        // Note that the press keeps the selection and the focus where they stand until it lands.
        keepFocus
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          setPicked(undefined);
          window.getSelection()?.removeAllRanges();
          onReply(picked.reply);
        }}
      >
        {REPLY_WORDS.REPLY}
      </Button>
    </div>,
    document.body,
  );
}

/** A quote block in the message box: the agent's words, three lines at most, and the press that takes it out, off while the box is held. */
export function ComposerQuoteView({
  quote,
  held,
}: {
  quote: ComposerQuote;
  held: boolean;
}): React.JSX.Element {
  return (
    <div className="composer-quote">
      <span className="composer-quote-words">{quote.words}</span>
      <Tooltip label={REPLY_WORDS.REMOVE}>
        {/* Note that the press keeps the caret where it stands, so the words around the quote stay where they were. */}
        <IconButton
          icon={<XIcon aria-hidden="true" />}
          label={REPLY_WORDS.REMOVE}
          size={BUTTON_SIZE.COMPACT}
          disabled={held}
          keepFocus
          onClick={quote.remove}
        />
      </Tooltip>
    </div>
  );
}
