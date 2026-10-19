import { CHAT_TARGET_SIGIL } from "@luke/features/chat-wire";
import { readerZone } from "@luke/features/date-mention";
import { ComboboxList, type ComboboxOption, comboboxOptionId } from "@luke/ui";
import { type ChatMention, type ChatTarget, chatRows } from "@luke/ui/chat-mention";
import { useId, useState } from "react";
import type { ComposerTrigger } from "../plan-editor/contract.js";
import { useMinute } from "./task-time.js";

/**
 * chat-mention-picker.tsx -- the list a chat box's `@` or `#` word opens over the box: the members or the channels it may name, narrowed as the word is typed, and the keys that move through it and write the one chosen.
 *
 * The editor reports the `@` word and the `#` word the caret ends, each on
 * its own report (`composer-editor.ts`), and the list is the chat's own
 * roster rather than the agent box's mentions (`mention-picker.tsx`), which
 * stand on a task's page: one row per member or channel, its handle or name
 * and a muted line of what it stands for (`chat-mention.ts`), after the
 * date the `@` words name where they read as one, said as its chip says
 * it with the date in full beside it. ↑ and ↓ move
 * the highlight, Enter or Tab writes the one highlighted, as the box writes
 * it (`chat-composer.tsx`), and Escape closes the list until the caret
 * leaves the word. A key
 * an input method is composing with is the method's.
 */

/** The list's own name, which its listbox is read by. */
const MENU_LABEL = "Mention";

type ChatSigil = (typeof CHAT_TARGET_SIGIL)[keyof typeof CHAT_TARGET_SIGIL];

/** The word the editor last reported for a sigil, as the list reads it. */
interface Reported {
  readonly sigil: ChatSigil;
  readonly trigger: ComposerTrigger;
}

/** The highlight as it was moved, held against the word it was moved in. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
}

/** What a chat box hands its editor and draws over it: the list, its ties for assistive technology, the two words' reports, and the keys the list takes first. */
export interface ChatMentionPicker {
  readonly menu: React.ReactNode;
  readonly aria: Readonly<Record<string, string | undefined>>;
  readonly onMemberTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onChannelTrigger: (trigger: ComposerTrigger | undefined) => void;
  /** A key in the box, heard before the editor's; answers whether the list took it. */
  readonly onKey: (event: KeyboardEvent) => boolean;
}

/** A row as the list draws it: a member or a channel by its sigil and name, a date as its chip says it. */
export function chatOption(target: ChatTarget): ComboboxOption {
  const label = target.date === undefined ? `${target.sigil}${target.name}` : target.name;
  return { id: label, label, detail: target.detail };
}

export function useChatMentionPicker({
  targets,
  onChoose,
}: {
  /** What an `@` or `#` word may name. */
  targets: readonly ChatTarget[];
  /** Writes the one chosen over the word typed: its chip, or its word (`@luke`, `#general`); a date as its chip. */
  onChoose: (target: ChatTarget) => void;
}): ChatMentionPicker {
  const id = useId();
  const now = useMinute();
  const [reported, setReported] = useState<Reported | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closed, setClosed] = useState<{ sigil: ChatSigil; start: number } | undefined>(undefined);
  // Note that each word reports on its own, so a word leaving clears only a list its own sigil opened.
  const reportFor = (sigil: ChatSigil) => (trigger: ComposerTrigger | undefined) =>
    setReported((was) =>
      trigger !== undefined ? { sigil, trigger } : was?.sigil === sigil ? undefined : was,
    );
  const mention: ChatMention | undefined =
    reported === undefined
      ? undefined
      : { sigil: reported.sigil, start: reported.trigger.start, query: reported.trigger.query };
  // A word closed with Escape stays closed only while the caret is in it, and only as the word it was: a `#` written over a closed `@` opens its own list.
  const shut =
    closed !== undefined && closed.start === mention?.start && closed.sigil === mention.sigil;
  if (closed !== undefined && !shut) setClosed(undefined);
  const rows = mention !== undefined && !shut ? chatRows(targets, mention, now, readerZone()) : [];
  const held =
    highlight !== undefined &&
    mention !== undefined &&
    highlight.start === mention.start &&
    highlight.query === mention.query
      ? highlight.at
      : 0;
  const at = Math.min(held, Math.max(rows.length - 1, 0));
  const listed = mention !== undefined && rows.length > 0;
  const choose = (target: ChatTarget) => onChoose(target);

  const onKey = (event: KeyboardEvent): boolean => {
    if (event.isComposing || !listed || mention === undefined) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setClosed({ sigil: mention.sigil, start: mention.start });
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : rows.length - 1;
      setHighlight({ start: mention.start, query: mention.query, at: (at + step) % rows.length });
      return true;
    }
    const row = rows[at];
    if (row !== undefined && ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab")) {
      event.preventDefault();
      choose(row);
      return true;
    }
    return false;
  };

  const menu =
    listed && mention !== undefined ? (
      <div className="menu-surface searchable-menu chat-mention-menu">
        <ComboboxList
          id={id}
          label={MENU_LABEL}
          groups={[
            {
              options: rows.map(chatOption),
            },
          ]}
          active={at}
          onActiveChange={(index) =>
            setHighlight({ start: mention.start, query: mention.query, at: index })
          }
          onChoose={(index) => {
            const target = rows[index];
            if (target !== undefined) choose(target);
          }}
        />
      </div>
    ) : null;
  return {
    menu,
    aria: {
      "aria-autocomplete": "list",
      "aria-expanded": String(listed),
      "aria-controls": listed ? id : undefined,
      "aria-activedescendant": listed ? comboboxOptionId(id, at) : undefined,
    },
    onMemberTrigger: reportFor(CHAT_TARGET_SIGIL.MEMBER),
    onChannelTrigger: reportFor(CHAT_TARGET_SIGIL.CHANNEL),
    onKey,
  };
}
