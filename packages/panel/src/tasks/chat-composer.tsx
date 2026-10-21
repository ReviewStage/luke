import { useAtomValue } from "@effect/atom-react";
import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { readerZone } from "@luke/features/date-mention";
import { ComboboxList, comboboxOptionId, ErrorState, GAP, Inline, SUBMIT_STATE } from "@luke/ui";
import {
  type ChatMention,
  type ChatTarget,
  chatMentionAt,
  chatRows,
  chooseTarget,
} from "@luke/ui/chat-mention";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import { type ChatDraftPlace, DRAFT_PLACE, EMPTY_DRAFT, useDraft } from "../composer-drafts.js";
import { useLinkWorkspace } from "../copy-link-item.js";
import { enterKeyHint, enterSends } from "../enter-sends.js";
import { imageFiles } from "../feedback-images.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type MentionNode,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { Tooltip } from "../tooltip.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { readFiles, withFiles } from "./attached-files.js";
import { chatOption, useChatMentionPicker } from "./chat-mention-picker.js";
import { ComposerField } from "./composer-field.js";
import { useDatePicker } from "./date-picker.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { type MentionDoors, MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { useMentionDoors, useTaskMentions } from "./task-mentions.js";
import { useMinute } from "./task-time.js";
import { DICTATION_PHASE, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";

/**
 * chat-composer.tsx -- the box a chat message is written in: at a place's foot, or under a thread opened for a reply, with the list an `@` or a `#` opens and a dictation laid in at the caret.
 *
 * The box is the shared composer card (`prompt-input.tsx`) around the agent
 * box's own editor (`composer-field.tsx`), as the agent tab's, the Inbox's,
 * and a plan comment's are, and under it the card's foot saying what it
 * takes, the microphone, and the shared round send. Enter sends, Shift-Enter
 * starts a new line, and the box is empty again once the post is taken; a
 * post refused keeps its words and says why under the box, with Retry,
 * which posts it once whatever the first try did, since the same words go
 * under the same key (`use-workspace-chat.ts`). While a post is out the
 * field is held and Send with it, and the caret comes back to the field
 * once it lands, unless it went somewhere else meanwhile, as the agent
 * box's does. Escape, where no list or dictation takes it, leaves the box.
 * What is typed and not sent is kept per channel, and per thread for a
 * reply, as every box that sends somewhere keeps it (`composer-drafts.ts`),
 * so another channel opened, a thread hidden, or the window reloaded finds
 * it where it was left. An `@` or a `#`
 * at the start of a word opens the chat's own list over the box
 * (`chat-mention-picker.tsx`). A member chosen, a person, an agent, or a
 * task's Luke, is written as their chip, the same mention link the agent
 * box, the Inbox, and a plan comment write
 * (`[@Ada Lovelace](…/person/<id>)`), which the service reads to tell them;
 * a channel is written as its word (`#general`).
 * Words after an `@` that read as a date offer it first, and a pick writes
 * the same date link the other boxes write (`[@Oct 20, 2026](luke://date/…)`).
 * A Luke address pasted whole is written as its chip, as it is in the
 * agent box, the Inbox, and a plan comment (`pastedMentionNode`).
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
  /** The channel the box posts in, which its draft is kept under. */
  readonly channelId: string;
  /** The thread's root the box replies under, by its place in the chat; none for a channel's foot. */
  readonly replyTo?: number | undefined;
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
            disabled={sending || empty}
          />
        </Tooltip>
      </Inline>
    </PromptInputFooter>
  );
}

/** What the box says under it: why a post did not go, which Retry sends again, or why a file or a dictation came to nothing. */
interface ComposerNote {
  readonly words: string;
  readonly retries: boolean;
}

/** A note that offers no Retry, or none at all. */
function plainNote(words: string | undefined): ComposerNote | undefined {
  return words === undefined ? undefined : { words, retries: false };
}

/** The draft's place: the channel's foot, or a thread in it. */
function chatPlace(channelId: string, replyTo: number | undefined): ChatDraftPlace {
  return replyTo === undefined
    ? { kind: DRAFT_PLACE.CHAT, channelId }
    : { kind: DRAFT_PLACE.CHAT, channelId, replyTo };
}

/**
 * Sends the draft kept for the box's place and its pictures once, holding
 * them while they go: let go once taken, kept with why where refused. A
 * send waits while pictures handed to the box are still being read.
 */
function useChatSend(place: ChatDraftPlace, onSend: ChatComposerProps["onSend"]) {
  const { draft: kept, update } = useDraft(place);
  const draft = kept.text;
  const { attachments } = kept;
  const [sending, setSending] = useState(false);
  // How many hand-offs of files are still being read, during which the post waits.
  const [reading, setReading] = useState(0);
  const [note, setNote] = useState<ComposerNote | undefined>(undefined);
  const empty = draft.trim() === "" && attachments.length === 0;
  const send = () => {
    if (empty || sending || reading > 0) return;
    const sent = kept;
    setSending(true);
    setNote(undefined);
    onSend(draft.trim(), attachments).then(
      (refused) => {
        setSending(false);
        if (refused !== undefined) {
          setNote({ words: refused, retries: true });
          return;
        }
        // Note that only what was sent is let go, so words typed meanwhile in another window stay.
        update((now) =>
          now.text === sent.text && now.attachments === sent.attachments ? EMPTY_DRAFT : now,
        );
      },
      (failed: Error) => {
        setSending(false);
        setNote({ words: failed.message, retries: true });
      },
    );
  };
  const setDraft = (text: string) => update((was) => ({ ...was, text }));
  /** Reads the images among the files handed in and takes them after those the box holds; the first that cannot come says why. */
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || sending) return;
    const images = imageFiles(files);
    const other = files.find((file) => !images.includes(file));
    setNote(plainNote(other === undefined ? undefined : NOT_IMAGE(other.name)));
    if (images.length === 0) return;
    setReading((count) => count + 1);
    readFiles(images)
      .then((read) => {
        // Taken after whatever the draft holds as the read lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        let refusal = read.refusal;
        update((was) => {
          const taken = withFiles(was.attachments, read, CHAT_BOUNDS.MAX_POST_PICTURES);
          refusal = taken.refusal;
          return { ...was, attachments: taken.attachments };
        });
        const said = refusal;
        if (said !== undefined) setNote((was) => was ?? plainNote(said));
      })
      .finally(() => setReading((count) => count - 1));
  };
  const remove = (index: number) => {
    setNote(undefined);
    update((was) => ({ ...was, attachments: was.attachments.filter((_, at) => at !== index) }));
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

/** Where a box's note stands, under the card: why a post did not go, with Retry beside it, or why a file or a dictation came to nothing. */
function NoteLine({
  note,
  onRetry,
}: {
  note: ComposerNote | undefined;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (note === undefined) return null;
  return (
    <div className="agent-composer-note">
      <ErrorState onRetry={note.retries ? onRetry : undefined}>{note.words}</ErrorState>
    </div>
  );
}

/** A chat box takes no skills, which are an agent's. */
const NO_SKILLS: ReadonlySet<string> = new Set();

/** The plan text a place off any task's page holds: none. */
const NO_TEXT = (): string => "";

/**
 * The mention a Luke address pasted whole stands for, as the other boxes
 * write it (`pastedMentionNode`). Note that the window's Chat stands on no
 * task's page, so its addresses are written under the workspace its links
 * are, and where none is known yet one pastes as the words it is, rather
 * than as a link naming no workspace.
 */
function usePastedMention(doors: MentionDoors): (words: string) => MentionNode | undefined {
  const known = useKnownNames();
  const text = useTaskMentions()?.text ?? NO_TEXT;
  const linkWorkspace = useLinkWorkspace();
  const workspace = doors.place.workspace === "" ? linkWorkspace : doors.place.workspace;
  return (words) =>
    workspace === undefined
      ? undefined
      : pastedMentionNode(
          words,
          { ...doors.place, workspace },
          { known, taskId: doors.taskId, text },
        );
}

/** The box on the agent box's editor: `@` and `#` open the chat's list over it, and the microphone lays a dictation in at the caret. */
function EditorChatComposer({
  channelId,
  replyTo,
  label,
  targets,
  keywords,
  compact,
  onSend,
  module,
}: ChatComposerProps & { module: PlanEditorModule | undefined }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  // A date chip in the box opens its picker over the card, as the agent box's does.
  const card = useRef<HTMLDivElement>(null);
  const datePicker = useDatePicker(card);
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
  } = useChatSend(chatPlace(channelId, replyTo), onSend);
  const dictation = useDictation({
    editor,
    keywords,
    onNote: (words) => setNote(plainNote(words)),
  });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const doors = useMentionDoors();
  const pasted = usePastedMention(doors);

  // Note that a held box gives up the caret, because a field that takes no
  // words can hold none; a send made from the box hands it back as the box
  // opens again, unless the caret went somewhere else meanwhile, as the
  // agent box's does (`agent-composer.tsx`).
  const refocus = useRef(false);
  useEffect(() => {
    if (sending || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    const dropped =
      active === null ||
      active === document.body ||
      room.current?.contains(active) === true ||
      (active instanceof HTMLButtonElement &&
        active.type === "submit" &&
        card.current?.contains(active) === true);
    if (dropped) editor.current?.focus();
  }, [sending]);
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
      ref={card}
      className="agent-composer chat-composer"
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
      {datePicker.popover}
      <PromptInput
        onSubmit={() => {
          refocus.current = card.current?.contains(document.activeElement) === true;
          send();
        }}
      >
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
          aria={{ ...mentions.aria, "aria-placeholder": label }}
          onKey={(event) => {
            if (dictation.onFieldKey(event) || mentions.onKey(event)) return true;
            // Escape, where no list or dictation takes it, leaves the box, as the agent box's does.
            if (event.key !== "Escape") return false;
            event.stopPropagation();
            editor.current?.blur();
            return true;
          }}
          onEnter={() => {
            if (room.current !== null) submitPromptInput(room.current);
          }}
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
            chip: (mention, node) => (
              <MentionNodeChip
                mention={mention}
                doors={doors}
                edit={{ node, pickDate: datePicker.open }}
              />
            ),
            pasted,
          }}
          // Note that a thread's box is opened by a press, so it takes the caret; a place's foot
          // leaves it where it is, as the Inbox's box does, because K and J step the chat's places
          // while the caret is out of the box.
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
              <AttachFilesButton
                label={ATTACH}
                accept={PICKS_IMAGES}
                disabled={sending}
                onFiles={attach}
              />
            }
          >
            <DictateButton dictation={dictation} disabled={sending || module === undefined} />
          </ComposerFoot>
        )}
      </PromptInput>
      <NoteLine note={note} onRetry={send} />
    </div>
  );
}

/** The plain box a bundle that failed to load leaves: a textarea whose `@` or `#` word opens the same list. */
function PlainChatComposer({
  channelId,
  replyTo,
  label,
  targets,
  compact,
  onSend,
}: ChatComposerProps): React.JSX.Element {
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, sending, empty, note, send } = useChatSend(
    chatPlace(channelId, replyTo),
    onSend,
  );
  // The field grows with its words, a line at a time, as a plan comment's plain field does.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft]);
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
      submitPromptInput(event.currentTarget);
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
    <div className="agent-composer chat-composer" data-compact={String(compact === true)}>
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
      <NoteLine note={note} onRetry={send} />
    </div>
  );
}
