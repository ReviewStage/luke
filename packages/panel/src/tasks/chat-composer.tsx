import { useAtomValue } from "@effect/atom-react";
import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { readerZone } from "@luke/features/date-mention";
import {
  ComboboxList,
  comboboxOptionId,
  GAP,
  IconButton,
  Inline,
  PlusIcon,
  SUBMIT_STATE,
} from "@luke/ui";
import {
  type ChatMention,
  type ChatTarget,
  chatMentionAt,
  chatRows,
  chooseTarget,
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
import { enterKeyHint, enterSends } from "../enter-sends.js";
import { imageFiles } from "../feedback-images.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { Tooltip } from "../tooltip.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { readFiles, withFiles } from "./attached-files.js";
import { chatOption, useChatMentionPicker } from "./chat-mention-picker.js";
import { ComposerField } from "./composer-field.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { MentionNodeChip } from "./mention-chip.js";
import { useMentionDoors } from "./task-mentions.js";
import { useMinute } from "./task-time.js";
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
 * (`chat-mention-picker.tsx`). A member chosen, a person, an agent, or a
 * task's Luke, is written as their chip, the same mention link the agent
 * box, the Inbox, and a plan comment write
 * (`[@Ada Lovelace](…/person/<id>)`), which the service reads to tell them;
 * a channel is written as its word (`#general`).
 * Words after an `@` that read as a date offer it first, and a pick writes
 * the same date link the other boxes write (`[@Oct 20, 2026](luke://date/…)`).
 * The microphone records a dictation and lays its words in at the
 * caret (`use-dictation.ts`), listening for the chat's members' names and
 * its channels' (`chatKeywords`). Pictures go with a post as files go with an Inbox
 * answer (`attached-files.ts`): the "+" at the foot's left opens the
 * system's picker for images, an image pasted into the box is taken, and
 * images dropped on the card are, each drawn as a chip above the words with
 * its way off, PNG, JPEG, and WebP kept and any other image re-encoded; a
 * file that cannot come says why under the card, and a post may be
 * pictures alone. While pictures are read the post waits for them. Where
 * the editor's bundle could not be loaded, a plain textarea stands in with
 * the same list and no pictures, so a message can always be written. What
 * is typed is a person's words, so the box is out of a session recording
 * (`ph-no-capture`) as well as masked.
 */

/** What the send press is called. */
const SEND = "Send";
const SENDING = "Sending";

/** What the box's + is called, which is its tooltip too. */
const ATTACH = "Attach images";

/** The pictures the system's picker offers: any image, re-encoded where it is none of the three a post keeps. */
const PICKS_IMAGES = "image/*";

/** Why a file that is no image did not come, in the words the box's note says. */
const NOT_IMAGE = (name: string) => `${name} can't be attached. Attach images.`;

/** Whether a drag carries files, which is all the card takes from one. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

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
  const options = rows.map(chatOption);
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
  /** What an `@` or `#` offers. */
  readonly targets: readonly ChatTarget[];
  /** The words a dictation here is likely to say (`chatKeywords`). */
  readonly keywords: readonly string[];
  /** Whether it stands under a thread, a line high, rather than at a place's foot. */
  readonly compact?: boolean;
  /** Sends the words and the pictures, either of which may be empty; answers why they were refused, or nothing once they are taken. */
  readonly onSend: (
    text: string,
    attachments: readonly CodingAgentAttachment[],
  ) => Promise<string | undefined>;
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

/** The bar under the box, as the agent box's and the Inbox's stand: the parts it leads with (the + of pictures), then the parts the box hands it (dictation's) and the round send at its end. */
function ComposerFoot({
  sending,
  empty,
  lead,
  children,
}: {
  sending: boolean;
  empty: boolean;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <PromptInputFooter>
      <PromptInputTools>{lead}</PromptInputTools>
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

/**
 * Sends the draft and its pictures once, holding them while they go:
 * emptied once taken, kept with why where refused. A send waits while
 * pictures handed to the box are still being read.
 */
function useChatSend(onSend: ChatComposerProps["onSend"]) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
  // Note that the pictures are read through a ref, because a read lands a while later and is taken after whatever the box holds by then.
  const held = useRef(attachments);
  held.current = attachments;
  const [sending, setSending] = useState(false);
  // How many hand-offs of files are still being read, during which the post waits.
  const [reading, setReading] = useState(0);
  const [note, setNote] = useState<string | undefined>(undefined);
  const empty = draft.trim() === "" && attachments.length === 0;
  const send = () => {
    const text = draft.trim();
    if (empty || sending || reading > 0) return;
    setSending(true);
    setNote(undefined);
    onSend(text, attachments).then(
      (refused) => {
        setSending(false);
        setNote(refused);
        if (refused !== undefined) return;
        setDraft("");
        setAttachments([]);
      },
      (failed: Error) => {
        setSending(false);
        setNote(failed.message);
      },
    );
  };
  /** Reads the images among the files handed in and takes them after those the box holds; the first that cannot come says why. */
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || sending) return;
    const images = imageFiles(files);
    const other = files.find((file) => !images.includes(file));
    setNote(other === undefined ? undefined : NOT_IMAGE(other.name));
    if (images.length === 0) return;
    setReading((count) => count + 1);
    readFiles(images)
      .then((read) => {
        // Taken after whatever the box holds as the read lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        const taken = withFiles(held.current, read, CHAT_BOUNDS.MAX_POST_PICTURES);
        held.current = taken.attachments;
        setAttachments(taken.attachments);
        const refusal = taken.refusal;
        if (refusal !== undefined) setNote((said) => said ?? refusal);
      })
      .finally(() => setReading((count) => count - 1));
  };
  const remove = (index: number) => {
    setNote(undefined);
    setAttachments((was) => was.filter((_, at) => at !== index));
  };
  return {
    draft,
    setDraft,
    attachments,
    attach,
    remove,
    sending,
    reading: reading > 0,
    empty,
    note,
    setNote,
    send,
  };
}

/** A chat box takes no skills, which are an agent's. */
const NO_SKILLS: ReadonlySet<string> = new Set();

/** The box on the agent box's editor: `@` and `#` open the chat's list over it, and the microphone lays a dictation in at the caret. */
function EditorChatComposer({
  label,
  targets,
  keywords,
  compact,
  onSend,
  module,
}: ChatComposerProps & { module: PlanEditorModule | undefined }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const {
    draft,
    setDraft,
    attachments,
    attach,
    remove,
    sending,
    reading,
    empty,
    note,
    setNote,
    send,
  } = useChatSend(onSend);
  const dictation = useDictation({ editor, keywords, onNote: setNote });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const doors = useMentionDoors();
  const mentions = useChatMentionPicker({
    targets,
    onChoose: (target) => {
      // A date is written as its chip, the date in full, wherever the box stands.
      if (target.date !== undefined) {
        editor.current?.chooseMention({ name: target.detail ?? target.name, target: target.date });
        return;
      }
      // A member is written as their chip, the link every box of the app writes; a channel as its word.
      if (target.link !== undefined) {
        editor.current?.chooseMention({ name: target.name, target: target.link });
        return;
      }
      editor.current?.chooseWords(`${target.sigil}${target.name}`);
    },
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a drop target alone; the keys it hears come from its own field and buttons.
    <div
      className="chat-composer"
      data-compact={String(compact === true)}
      data-dropping={dropping ? "" : undefined}
      onDragOver={(event) => {
        if (!carriesFiles(event) || sending) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // A drag moving onto one of the card's own children has not left it.
        const into = event.relatedTarget;
        if (!(into instanceof Node && event.currentTarget.contains(into))) setDropping(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event) || sending) return;
        event.preventDefault();
        setDropping(false);
        attach(Array.from(event.dataTransfer.files));
      }}
    >
      {mentions.menu}
      <PromptInput onSubmit={send}>
        <AttachedFileChips
          files={attachmentChips(attachments)}
          onRemove={sending ? undefined : remove}
        />
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
          aria={mentions.aria}
          onKey={(event) => dictation.onFieldKey(event) || mentions.onKey(event)}
          onEnter={send}
          onPasteFiles={(files) => {
            // Only images are taken from the clipboard; text pastes as it always does.
            const pasted = imageFiles(files);
            if (pasted.length === 0) return false;
            attach(pasted);
            return true;
          }}
          onTrigger={() => undefined}
          chip={() => null}
          mentions={{
            onTrigger: mentions.onMemberTrigger,
            onChannelTrigger: mentions.onChannelTrigger,
            chip: (mention) => <MentionNodeChip mention={mention} doors={doors} />,
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
          <ComposerFoot
            sending={sending}
            empty={empty || reading}
            lead={
              <>
                <Tooltip label={ATTACH}>
                  <IconButton
                    icon={<PlusIcon />}
                    label={ATTACH}
                    disabled={sending}
                    onClick={() => picker.current?.click()}
                  />
                </Tooltip>
                <input
                  ref={picker}
                  type="file"
                  accept={PICKS_IMAGES}
                  multiple
                  hidden
                  onChange={(event) => {
                    const picked = Array.from(event.currentTarget.files ?? []);
                    // Cleared so the same file can be picked again after it was taken off.
                    event.currentTarget.value = "";
                    attach(picked);
                  }}
                />
              </>
            }
          >
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
  targets,
  compact,
  onSend,
}: ChatComposerProps): React.JSX.Element {
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, sending, empty, note, send } = useChatSend(onSend);
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

  const now = useMinute();
  const zone = readerZone();
  // Note that this box reads an `@` word as one word, so it offers a date one word names (`@tomorrow`, `@fri`) and the editor the rest.
  const mention: ChatMention | undefined =
    caret === undefined ? undefined : chatMentionAt(draft, caret);
  // A word closed with Escape stays closed only while the caret is in it.
  if (closedAt !== undefined && mention?.start !== closedAt) setClosedAt(undefined);
  const open = mention !== undefined && closedAt !== mention.start;
  const rows = open ? chatRows(targets, mention, now, zone) : [];
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
    const written = chooseTarget(draft, mention, target);
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
    if (enterSends(event)) {
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
          enterKeyHint={enterKeyHint()}
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
        <ComposerFoot sending={sending} empty={empty} />
      </PromptInput>
      {note === undefined ? null : (
        <p className="error-message chat-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
