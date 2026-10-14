import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import {
  type ChatMention,
  type ChatTarget,
  chatMentionAt,
  chooseTarget,
  matchingTargets,
} from "@luke/ui/chat-mention";
import { ArrowUpIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { BusyLabel } from "../spinner";
import { Tooltip } from "../tooltip";

/**
 * chat-composer.tsx -- the box a chat message is written in: at a place's foot, or under a thread opened for a reply, with the list an `@` or a `#` opens.
 *
 * The box is a plain textarea over a bar that says what it takes, and a
 * round send press at the bar's end. Enter sends, Shift-Enter starts a new
 * line, and the box is empty again once the post is taken; a post refused
 * keeps its words and says why under the box. An `@` or a `#` at the
 * start of a word opens the list over the box (`chat-mention.ts`), one row
 * per member or channel, its handle or name and a muted line of what it
 * stands for, narrowed as it is typed: ↑ and ↓ move the highlight, Enter
 * or Tab writes the one highlighted, and Escape closes the list until the
 * caret leaves the word, as the agent composer's `/` list does
 * (`skill-picker.tsx`). The caret stays in the box throughout. What is
 * typed is a person's words, so the box is out of a session recording
 * (`ph-no-capture`) as well as masked.
 */

/** What the send press is called. */
const SEND = "Send";

/** The list's own name, which its listbox is read by. */
const MENTION_MENU_LABEL = "Mention";

/** The highlight as it was moved, held against the word it was moved in. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** One row's id, under the list's own. */
function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/** The list an `@` or `#` word opens: a row per target offered, the highlighted one washed. */
function MentionMenu({
  id,
  rows,
  at,
  onHover,
  onChoose,
}: {
  id: string;
  rows: readonly ChatTarget[];
  at: number;
  onHover: (index: number) => void;
  onChoose: (target: ChatTarget) => void;
}): React.JSX.Element {
  return (
    <div className="menu-surface searchable-menu chat-mention-menu">
      {/* Note that a press on a row keeps the caret in the box, where the keys are read. */}
      <div
        id={id}
        className="plan-compose-menu-list"
        role="listbox"
        aria-label={MENTION_MENU_LABEL}
        onMouseDown={(event) => event.preventDefault()}
      >
        {rows.map((target, index) => (
          <button
            key={`${target.sigil}${target.name}`}
            id={optionId(id, index)}
            type="button"
            role="option"
            tabIndex={-1}
            className="menu-item"
            aria-selected={index === at}
            onMouseMove={() => onHover(index)}
            onClick={() => onChoose(target)}
          >
            <span className="plan-compose-menu-name">
              {target.sigil}
              {target.name}
            </span>
            {target.detail === undefined ? null : (
              <span className="skill-menu-description">{target.detail}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The composer: the box, the list its words open, the bar under it, and why a post was refused. */
export function ChatComposer({
  label,
  hints,
  targets,
  compact,
  onSend,
}: {
  /** What the box asks for while empty, which names it for assistive technology too. */
  label: string;
  /** What the bar says the box takes, each a short line. */
  hints: readonly string[];
  /** What an `@` or `#` offers. */
  targets: readonly ChatTarget[];
  /** Whether it stands under a thread, a line high, rather than at a place's foot. */
  compact?: boolean;
  /** Sends the words; answers why they were refused, or nothing once they are taken. */
  onSend: (text: string) => Promise<string | undefined>;
}): React.JSX.Element {
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closedAt, setClosedAt] = useState<number | undefined>(undefined);
  // Note that the caret an edit leaves is set once its words are in the box, on the next render.
  const pendingCaret = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined || field.current === null) return;
    field.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = undefined;
  }, [draft]);

  const mention: ChatMention | undefined =
    caret === undefined ? undefined : chatMentionAt(draft, caret);
  // A word closed with Escape stays closed only while the caret is in it.
  if (closedAt !== undefined && mention?.start !== closedAt) setClosedAt(undefined);
  const open = mention !== undefined && closedAt !== mention.start;
  const rows = open ? matchingTargets(targets, mention) : [];
  const held =
    highlight !== undefined &&
    mention !== undefined &&
    highlight.start === mention.start &&
    highlight.query === mention.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  const listed = open && rows.length > 0;

  const choose = (target: ChatTarget) => {
    if (mention === undefined) return;
    const written = chooseTarget(draft, mention, target.name);
    if (written.text.length > CHAT_BOUNDS.MAX_TEXT_CHARS) return;
    pendingCaret.current = written.caret;
    setDraft(written.text);
  };
  const send = () => {
    const text = draft.trim();
    if (text === "" || sending) return;
    setSending(true);
    setNote(undefined);
    onSend(text).then(
      (refused) => {
        setSending(false);
        setNote(refused);
        if (refused === undefined) setDraft("");
      },
      (failed: Error) => {
        setSending(false);
        setNote(failed.message);
      },
    );
  };
  const onCaret = () => {
    const now = field.current;
    if (now === null) return;
    setCaret(now.selectionStart === now.selectionEnd ? now.selectionStart : undefined);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (listed && mention !== undefined) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setClosedAt(mention.start);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
        setHighlight({ start: mention.start, query: mention.query, at: (at + step) % rows.length });
        return;
      }
      const row = rows[at];
      if (
        row !== undefined &&
        ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab")
      ) {
        event.preventDefault();
        choose(row);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  // The box's ties to the list, for assistive technology, as the agent composer's are (`skill-picker.tsx`).
  const listProps = {
    "aria-autocomplete": "list",
    "aria-expanded": listed,
    "aria-controls": listed ? listId : undefined,
    "aria-activedescendant": listed ? optionId(listId, at) : undefined,
  } as const;
  return (
    <div className="chat-composer" data-compact={String(compact === true)}>
      <div className="chat-composer-box">
        {listed && mention !== undefined ? (
          <MentionMenu
            id={listId}
            rows={rows}
            at={at}
            onHover={(index) =>
              setHighlight({ start: mention.start, query: mention.query, at: index })
            }
            onChoose={choose}
          />
        ) : null}
        <textarea
          ref={field}
          className="chat-composer-field ph-no-capture"
          aria-label={label}
          placeholder={label}
          rows={compact === true ? 1 : 2}
          maxLength={CHAT_BOUNDS.MAX_TEXT_CHARS}
          value={draft}
          disabled={sending}
          {...listProps}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            onCaret();
          }}
          onSelect={onCaret}
          onKeyDown={onKeyDown}
          onBlur={() => setCaret(undefined)}
        />
        <div className="chat-composer-bar">
          {hints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
          <Tooltip label={SEND}>
            <button
              type="button"
              className="chat-send"
              aria-label={SEND}
              disabled={sending || draft.trim() === ""}
              onClick={send}
            >
              <BusyLabel busy={sending} label="Sending">
                <ArrowUpIcon aria-hidden="true" />
              </BusyLabel>
            </button>
          </Tooltip>
        </div>
      </div>
      {note === undefined ? null : (
        <p className="error-message chat-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
