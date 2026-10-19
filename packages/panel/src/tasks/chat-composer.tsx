import { useAtomValue } from "@effect/atom-react";
import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import {
  ComboboxList,
  comboboxOptionId,
  GAP,
  Inline,
  SUBMIT_STATE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import {
  type ChatMention,
  type ChatTarget,
  chatMentionAt,
  chooseTarget,
  matchingTargets,
} from "@luke/ui/chat-mention";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
} from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { Tooltip } from "../tooltip.js";
import { useChatMentionPicker } from "./chat-mention-picker.js";
import { ComposerField } from "./composer-field.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { DICTATION_PHASE, useDictation } from "./use-dictation.js";

/**
 * chat-composer.tsx -- the box a chat message is written in: at a place's foot, or under a thread opened for a reply, with the list an `@` or a `#` opens and a dictation laid in at the caret.
 *
 * The box is the shared composer card (`prompt-input.tsx`) around the agent
 * box's own editor (`composer-field.tsx`), as the agent tab's, the Inbox's,
 * and a plan comment's are, and under it the card's foot saying what it
 * takes, the microphone, and the shared round send. Enter sends, Shift-Enter
 * starts a new line, and the box is empty again once the post is taken; a
 * post refused keeps its words and says why under the box. An `@` or a `#`
 * at the start of a word opens the chat's own list over the box
 * (`chat-mention-picker.tsx`), and the one chosen is written as its word
 * (`@agent-2`, `#general`), which is how the service reads who a message
 * names. The microphone records a dictation and lays its words in at the
 * caret (`use-dictation.ts`), listening for the chat's handles and channel
 * names (`chatKeywords`). Where the editor's bundle could not be loaded, a
 * plain textarea stands in with the same list, so a message can always be
 * written. What is typed is a person's words, so the box is out of a
 * session recording (`ph-no-capture`) as well as masked.
 */

/** What the send press is called. */
const SEND = "Send";
const SENDING = "Sending";

/** The list's own name, which its listbox is read by. */
const MENTION_MENU_LABEL = "Mention";

/** The highlight as it was moved, held against the word it was moved in. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly at: number;
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
  const options = rows.map((target) => ({
    id: `${target.sigil}${target.name}`,
    label: `${target.sigil}${target.name}`,
    detail: target.detail,
  }));
  return (
    <div className="menu-surface searchable-menu chat-mention-menu">
      <ComboboxList
        id={id}
        label={MENTION_MENU_LABEL}
        groups={[{ options }]}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const target = rows[index];
          if (target !== undefined) onChoose(target);
        }}
      />
    </div>
  );
}

/** What a chat box is handed by the place it stands in. */
interface ChatComposerProps {
  /** What the box asks for while empty, which names it for assistive technology too. */
  readonly label: string;
  /** What the bar says the box takes, each a short line. */
  readonly hints: readonly string[];
  /** What an `@` or `#` offers. */
  readonly targets: readonly ChatTarget[];
  /** The words a dictation here is likely to say (`chatKeywords`). */
  readonly keywords: readonly string[];
  /** Whether it stands under a thread, a line high, rather than at a place's foot. */
  readonly compact?: boolean;
  /** Sends the words; answers why they were refused, or nothing once they are taken. */
  readonly onSend: (text: string) => Promise<string | undefined>;
}

/** The composer: the agent box's editor once its bundle has loaded, with dictation, and the plain box where the bundle failed, so a message can always be written. */
export function ChatComposer(props: ChatComposerProps): React.JSX.Element {
  const bundle = useAtomValue(useSideBundles().planEditor);
  if (AsyncResult.isFailure(bundle)) return <PlainChatComposer {...props} />;
  return (
    <EditorChatComposer
      {...props}
      module={AsyncResult.isSuccess(bundle) ? bundle.value : undefined}
    />
  );
}

/** The bar under the box: what it takes, then the parts the box hands it (dictation's), then the round send. */
function ComposerFoot({
  hints,
  sending,
  empty,
  children,
}: {
  hints: readonly string[];
  sending: boolean;
  empty: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <PromptInputFooter>
      <PromptInputTools>
        <Inline gap={GAP.FIELD} wrap={false}>
          {hints.map((hint) => (
            <Text
              key={hint}
              as={TEXT_ELEMENT.SPAN}
              variant={TEXT_VARIANT.CAPTION}
              tone={TEXT_TONE.SUBTLE}
              truncate
            >
              {hint}
            </Text>
          ))}
        </Inline>
      </PromptInputTools>
      <Inline gap={GAP.TIGHT} wrap={false}>
        {children}
        <Tooltip label={SEND}>
          <PromptInputSubmit
            label={SEND}
            status={sending ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.READY}
            disabled={!sending && empty}
            busy={sending}
            busyLabel={SENDING}
          />
        </Tooltip>
      </Inline>
    </PromptInputFooter>
  );
}

/** Sends the draft once, holding it while it goes: emptied once taken, kept with why where refused. */
function useChatSend(onSend: ChatComposerProps["onSend"]) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
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
  return { draft, setDraft, sending, note, setNote, send };
}

/** A chat box takes no skills, which are an agent's. */
const NO_SKILLS: ReadonlySet<string> = new Set();

/** The box on the agent box's editor: `@` and `#` open the chat's list over it, and the microphone lays a dictation in at the caret. */
function EditorChatComposer({
  label,
  hints,
  targets,
  keywords,
  compact,
  onSend,
  module,
}: ChatComposerProps & { module: PlanEditorModule | undefined }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const { draft, setDraft, sending, note, setNote, send } = useChatSend(onSend);
  const dictation = useDictation({ editor, keywords, onNote: setNote });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const picker = useChatMentionPicker({
    targets,
    onChoose: (words) => editor.current?.chooseWords(words),
  });
  return (
    <div className="chat-composer" data-compact={String(compact === true)}>
      {picker.menu}
      <PromptInput onSubmit={send}>
        <ComposerField
          module={module}
          editor={editor}
          room={room}
          draft={draft}
          setDraft={setDraft}
          placeholder={label}
          label={label}
          input={
            sending
              ? COMPOSER_INPUT.DISABLED
              : dictating
                ? COMPOSER_INPUT.READ_ONLY
                : COMPOSER_INPUT.EDITABLE
          }
          maxLength={CHAT_BOUNDS.MAX_TEXT_CHARS}
          skills={NO_SKILLS}
          aria={picker.aria}
          onKey={(event) => dictation.onFieldKey(event) || picker.onKey(event)}
          onEnter={send}
          onPasteFiles={() => false}
          onTrigger={() => undefined}
          chip={() => null}
          mentions={{
            onTrigger: picker.onMemberTrigger,
            onChannelTrigger: picker.onChannelTrigger,
            chip: (mention) => `@${mention.name}`,
            pasted: () => undefined,
          }}
          // Note that a thread's box is opened by a press, so it takes the caret; a place's foot leaves it where it is.
          takesFocus={false}
          focus={compact === true ? true : undefined}
        />
        {dictating ? (
          <PromptInputFooter>
            <DictationStrip dictation={dictation} />
          </PromptInputFooter>
        ) : (
          <ComposerFoot hints={hints} sending={sending} empty={draft.trim() === ""}>
            <DictateButton dictation={dictation} disabled={sending || module === undefined} />
          </ComposerFoot>
        )}
      </PromptInput>
      {note === undefined ? null : (
        <p className="error-message chat-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

/** The plain box a bundle that failed to load leaves: a textarea whose `@` or `#` word opens the same list. */
function PlainChatComposer({
  label,
  hints,
  targets,
  compact,
  onSend,
}: ChatComposerProps): React.JSX.Element {
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, sending, note, send } = useChatSend(onSend);
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
  const onCaret = () => {
    const now = field.current;
    if (now === null) return;
    setCaret(now.selectionStart === now.selectionEnd ? now.selectionStart : undefined);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Note that every key an input method composes with is the method's, its candidates' arrows and Escape among them.
    if (event.nativeEvent.isComposing) return;
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  // The box's ties to the list, for assistive technology, as the agent composer's are (`skill-picker.tsx`).
  const listProps = {
    "aria-autocomplete": "list",
    "aria-expanded": listed,
    "aria-controls": listed ? listId : undefined,
    "aria-activedescendant": listed ? comboboxOptionId(listId, at) : undefined,
  } as const;
  return (
    <div className="chat-composer" data-compact={String(compact === true)}>
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
      <PromptInput onSubmit={send}>
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
        <ComposerFoot hints={hints} sending={sending} empty={draft.trim() === ""} />
      </PromptInput>
      {note === undefined ? null : (
        <p className="error-message chat-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
