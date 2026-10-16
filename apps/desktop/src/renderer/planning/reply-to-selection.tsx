import { replyOf } from "@luke/ui/reply-quote";
import { CornerDownRightIcon, ReplyIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "../tooltip";

/**
 * reply-to-selection.tsx -- words selected in an agent's message answered from its message box: Reply over the selection, and the reply quoted over the box with its way off.
 *
 * Every chat that does this, ChatGPT's "Ask ChatGPT" and Claude's Reply,
 * offers a press beside the words once they are selected, and the press
 * lays them over the composer as one quote of their own, apart from the
 * words being written, with a way off; the quote leads the message once it
 * is sent. So here: a selection inside an agent's own words, a text part
 * of one of its messages, which wears `REPLY_SCOPE`, never a call's output
 * or a thought beside it, stands Reply over it once
 * the pointer or the keys let it go, and a press hands the words to the
 * agent's box (`use-agent-composer.ts`'s `setReply`), which quotes them
 * (`ComposerReply`) and sends them as a Markdown quote leading the words
 * (`@luke/ui/reply-quote`). The press is drawn over the window, not inside
 * the transcript, so the log's own clipping never cuts it, follows the
 * selection as the log scrolls, and goes as the selection does. Note that
 * the press takes no focus and leaves the selection as it was until it is
 * pressed, because a press that took either would end what it answers.
 */

/** The attribute that marks an agent's own words in a transcript, which a selection inside may be replied to. */
export const REPLY_SCOPE = "data-reply-scope";

const SCOPE_SELECTOR = `[${REPLY_SCOPE}]`;

/** What the presses are called, which are their names and their hints. */
const REPLY_WORDS = {
  REPLY: "Reply",
  REMOVE: "Remove reply",
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
      <button
        type="button"
        className="toolbar-button"
        // Note that the press keeps the selection and the focus where they stand until it lands.
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setPicked(undefined);
          window.getSelection()?.removeAllRanges();
          onReply(picked.reply);
        }}
      >
        <ReplyIcon aria-hidden="true" />
        {REPLY_WORDS.REPLY}
      </button>
    </div>,
    document.body,
  );
}

/** The reply over the message box: the agent's words it answers, quoted, and the press that takes it off; nothing without one. */
export function ComposerReply({
  reply,
  onRemove,
}: {
  reply: string;
  /** Takes the reply off; none while the box is held, when it stays. */
  onRemove: (() => void) | undefined;
}): ReactNode {
  if (reply === "") return null;
  return (
    <div className="agent-composer-reply">
      <CornerDownRightIcon aria-hidden="true" className="agent-composer-reply-glyph" />
      <blockquote className="agent-composer-reply-words">{reply}</blockquote>
      <Tooltip label={REPLY_WORDS.REMOVE}>
        <button
          type="button"
          className="icon-button agent-composer-reply-remove"
          aria-label={REPLY_WORDS.REMOVE}
          disabled={onRemove === undefined}
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
