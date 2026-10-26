import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { INBOX_BOUNDS, type InboxItem, type InboxMessage } from "@luke/features/inbox-wire";
import { pasteCutWords } from "@luke/features/words";
import { ComposerBody, ComposerFoot, type ComposerNote, STATUS_TONE } from "@luke/ui";
import { SERVER_HANDED } from "@luke/ui/agent-servers-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type RefObject, useRef, useState } from "react";
import { PromptInput, submitPromptInput } from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerQuote,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { type ComposerPickers, useComposerPickers } from "./composer-pickers.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import {
  acknowledgedOnOpen,
  asksNod,
  type InboxDraft,
  inboxNoteReading,
  inboxThreadSend,
} from "./inbox-model.js";
import { ComposerQuoteView, ReplyToSelection } from "./reply-to-selection.js";
import type { SkillSource } from "./skill-picker.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * inbox-answer-box.tsx -- the box at the end of every Inbox item's thread, the reader's draft reply: while a question waits the box is the question, its controls the card's body, the note line under them, and under that the foot's row of + at the left and the microphone and Send at the right; otherwise the line and the foot alone, a reply.
 *
 * The box is the agent composer's card (`ai-elements/prompt-input.tsx`)
 * around the agent composer's field (`composer-field.tsx`), and takes what
 * that box takes, through the same pickers (`composer-pickers.tsx`): an `@`
 * opens the list of what the note may mention, where the page hands
 * mentions, the plan's own on a plan's Inbox and the item's repository's
 * in the window's, each written in as its link and drawn as its chip; a `/`
 * opens the repository's skills; and the microphone left of the send
 * records words into the line at the caret, the strip standing in the foot
 * in place of its presses until ✓ or Enter, or ✕ or Escape. The note
 * goes to the agent as it was written, links and all, so what a mention
 * names reaches the agent as a message's does.
 *
 * While a question waits, its controls (`inbox-pane.tsx`) are the card's
 * body, with no card, border, or head of their own, since the agent's
 * message says what it asks: an ask's options, steps and presses, or
 * fields, each numbered and pressed as before. Under them stands the note line, "Add a note", a
 * full-width line that grows as it is written, and under it the foot's row
 * of presses, laid as the agent's box lays its. Where no
 * controls stand, an ask of words alone, a notice, or a settled item, the
 * box is that line and that row alone and its line asks for a "Reply", the
 * words of which answer an ask of words alone (`inbox-model.ts`'s
 * `attachedAnswers`).
 *
 * The box says nothing of its own about what a send does: Send stands held
 * until the box holds something to send, a pick, a tick, a field filled,
 * words, or files, and that is all it says. Enter sends what Send would,
 * Shift+Enter is a new line, and Escape leaves the box, as in the agent's
 * box. The one exception is a notice waiting on the reader's nod, where
 * Send reads "Got it" while the box is empty, which settles it without
 * messaging the agent (`use-task-inbox.ts`'s `onAcknowledge`), and is the
 * round Send again
 * once a word or a file is in. A notice opening acknowledges
 * (`inbox-model.ts`'s `acknowledgedOnOpen`, `use-inbox-read-marks.ts`'s
 * `useNodOnOpen`) offers no Got it, since opening it was the nod. Unlike
 * the agent's box, the field never takes the caret as an item opens,
 * because K and J step the list and the number keys pick while the caret
 * is elsewhere.
 *
 * Files go with a reply as they go with a message (`use-attached-files.ts`):
 * the + at the foot's left opens the system's file picker, an image pasted
 * into the box is taken, and files dropped on the card are, each drawn as a
 * chip over the foot's bar with its way off; a file that cannot come says
 * why under it. Files stand for the developer's own words where they
 * wrote none, and while they are read the reply waits for them.
 *
 * Words selected in the agent's part of the thread and answered with Reply
 * are laid into the box as a quote block where the caret stands, the box
 * then taking the caret, as the agent's own box takes them
 * (`reply-to-selection.tsx`); a quote goes out as a Markdown blockquote,
 * part of the reply like any other words. The box stands Reply itself,
 * over the thread it is handed, and only while its editor is loaded and
 * takes a quote, never while a send is out or a dictation holds it, since
 * a press lets the selection go.
 *
 * Why a reply did not go, a file did not come, or a dictation left
 * nothing, is said under the foot's bar. A send refused because the agent is
 * archived says so, with Unarchive after it, which brings the agent back and
 * lets the note go, so the words kept in the box are sent again by a press.
 * Once the item is settled, answered or taken back, the same box writes a
 * message on its thread, which reaches the agent and leaves the item where
 * it stands.
 */

/** Whether the box holds neither words nor files. */
function emptyBox(draft: InboxDraft): boolean {
  return draft.note.trim() === "" && draft.attachments.length === 0;
}

/** What the note line asks for under an open question's controls, which are the answer, the note going beside it. */
const NOTE_PLACEHOLDER = "Add a note";

/** What the box asks for where no controls stand over its line: an ask of words alone, a notice, or a settled item, whose words are the reply. */
const REPLY_PLACEHOLDER = "Reply";

/** What the note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The answer box could not be loaded.";

/** What the box's round Send is called, which is its tooltip too. */
const SEND = "Send";

/** What Send is named while its send is out. */
const SENDING = "Sending";

/** What Send reads on an empty notice that waits on the reader's nod, which settles it without messaging the agent. */
const GOT_IT = "Got it";

/** What the press after an archived agent's note says. */
const UNARCHIVE = "Unarchive";

/**
 * What a box's note line asks for: a note, where a question's controls
 * stand over it as the answer; the asker's own placeholder where it gave
 * one for words; and a reply otherwise.
 */
function answerPlaceholder(asks: boolean, own: string | undefined): string {
  if (asks) return NOTE_PLACEHOLDER;
  return own ?? REPLY_PLACEHOLDER;
}

/** A box's field as its owner holds it: its editor, the field it stands in, the editor's bundle, and its lists and dictation. */
interface AnswerField {
  readonly editor: RefObject<ComposerEditorHandle | undefined>;
  readonly room: RefObject<HTMLDivElement | null>;
  /** The editor's bundle, once it has loaded; none while it loads or where it could not. */
  readonly module: PlanEditorModule | undefined;
  /** Whether the editor's bundle could not be loaded. */
  readonly failed: boolean;
  readonly pickers: ComposerPickers;
}

/**
 * A box's field, its editor, its lists, and its dictation, all its own: an
 * `@` lists what the page hands, a `/` the repository's skills, and a
 * server's chip says what a send does with it, a turn opened or the running
 * one steered, by the agent the words go to.
 */
function useAnswerField({
  draft,
  placeholder,
  self,
  agent,
  skills,
  keywords,
  statuses,
  onNote,
}: {
  draft: string;
  placeholder: string;
  /** The agent the words go to, which the `@` list does not offer; none where they go to no agent. */
  self: string | undefined;
  /** That agent as its holder's read lists it, whose servers' switches a server's chip reads; none before the read lands, or for no agent. */
  agent: CodingAgentSummary | undefined;
  skills: SkillSource | undefined;
  keywords: readonly string[];
  statuses: IntegrationStatuses;
  /** Says why a dictation left nothing, or clears what the last one said. */
  onNote: (note: string | undefined) => void;
}): AnswerField {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const bundle = useAtomValue(useSideBundles().planEditor);
  const pickers = useComposerPickers({
    editor,
    room,
    draft,
    placeholder,
    self,
    skills,
    keywords,
    // A server's chip says what the answer does with it: opens a turn, or steers the one running.
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed:
          agent?.status === CODING_AGENT_STATUS.RUNNING
            ? SERVER_HANDED.STEERS
            : SERVER_HANDED.OPENS,
      },
    },
    onNote,
  });
  return {
    editor,
    room,
    module: AsyncResult.isSuccess(bundle) ? bundle.value : undefined,
    failed: AsyncResult.isFailure(bundle),
    pickers,
  };
}

/** What a box's card is drawn with: its field, what stands over the note line, the note line, and the foot's presses. */
interface AnswerFormProps {
  readonly field: AnswerField;
  /** Whether a question's controls stand over the note line. */
  readonly asks: boolean;
  /** Whether the box writes a message on a settled thread rather than an answer. */
  readonly messages: boolean;
  /** The question's controls, the card's body over the note line; nothing where none stand. */
  readonly controls: React.ReactNode;
  /** The files the box holds, as chips over the note line; nothing where it takes none. */
  readonly chips?: React.ReactNode;
  readonly note: string;
  readonly onNote: (note: string) => void;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly onEnter: () => void;
  /** Takes files pasted into the line, answering whether it took them; none where the box takes no files. */
  readonly onPasteFiles?: ((files: readonly File[]) => boolean) | undefined;
  /** Told once a paste past `maxLength` has been cut to fit; a box that gives no word of it cuts silently. */
  readonly onPasteCut?: (() => void) | undefined;
  /** How a quote block the line holds is drawn; none where the box takes no quote. */
  readonly quote?: ((quote: ComposerQuote) => React.ReactNode) | undefined;
  /** What leads the foot, the + of files; nothing where the box takes none. */
  readonly tools?: React.ReactNode;
  /** What the foot says under its bar: why a send did not go, a file did not come, or a dictation left nothing; nothing where it has nothing to say. */
  readonly says?: ComposerNote | undefined;
  /** Whether Send reads Got it, a nod that messages nobody. */
  readonly nod: boolean;
  readonly sending: boolean;
  /** Whether a send waits, while one is out or files are read. */
  readonly held: boolean;
  /** Whether the box holds something to send, which lights its Send. */
  readonly sendable: boolean;
  readonly onSubmit: () => void;
  /** Whether files are dragged over the box, which brightens its edge. */
  readonly dropping?: boolean | undefined;
}

/**
 * A box's card: the question's controls as its body, the note line on its
 * own over the foot with the files the box has over it (`ComposerBody`), and
 * the foot (`ComposerFoot`), which holds the + at its left, the counter, the microphone and Send at its
 * right, a dictation's strip in their place, and what the box says under
 * them; Send reading Got it where the box nods.
 */
function AnswerForm({
  field,
  asks,
  messages,
  controls,
  chips,
  note,
  onNote,
  placeholder,
  maxLength,
  onEnter,
  onPasteFiles,
  onPasteCut,
  quote,
  tools,
  says,
  nod,
  sending,
  held,
  sendable,
  onSubmit,
  dropping,
}: AnswerFormProps): React.JSX.Element {
  const { editor, room, module, pickers } = field;
  const { dictation, dictating } = pickers;
  return (
    <PromptInput
      className="inbox-answer"
      data-asks={asks ? "" : undefined}
      data-messages={messages ? "" : undefined}
      dropping={dropping}
      onSubmit={onSubmit}
    >
      {controls}
      {/* The note line stands on its own over the foot, as the agent's box's field does, its files over it. */}
      <ComposerBody files={chips}>
        <ComposerField
          module={module}
          editor={editor}
          room={room}
          draft={note}
          setDraft={onNote}
          placeholder={placeholder}
          label={placeholder}
          input={dictating ? COMPOSER_INPUT.READ_ONLY : COMPOSER_INPUT.EDITABLE}
          maxLength={maxLength}
          takesFocus={false}
          {...pickers.field}
          onEnter={onEnter}
          onPasteFiles={onPasteFiles ?? takesNoFiles}
          onPasteCut={onPasteCut}
          quote={quote}
        />
      </ComposerBody>
      <ComposerFoot
        tools={tools}
        counter={{ length: note.length, limit: maxLength }}
        actions={<DictateButton dictation={dictation} disabled={module === undefined} />}
        strip={dictating ? <DictationStrip dictation={dictation} /> : undefined}
        send={{
          label: nod ? GOT_IT : SEND,
          inWords: nod,
          empty: !sendable,
          held,
          busy: sending,
          busyLabel: SENDING,
        }}
        note={says}
      />
    </PromptInput>
  );
}

/** Takes no pasted file, so the paste writes as it always does. */
function takesNoFiles(): boolean {
  return false;
}

/** What an item's box is drawn with, beside where the account's servers stand. */
interface AnswerBoxProps {
  item: InboxItem;
  /** The account reading the Inbox, whose own notice opening acknowledges; none before it is known. */
  readerId: string | undefined;
  control: TaskInboxControl;
  /** The item's agent as its holder's read lists it, whose servers' switches a server's chip reads; none before the read lands. */
  agent: CodingAgentSummary | undefined;
  /** The item's thread, which the box replies to. */
  thread: readonly InboxMessage[];
  /** The open ask's controls, the card's body over its foot; nothing where none waits, or the ask is of words alone. */
  controls: React.ReactNode;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  skills: SkillSource | undefined;
  /** The words a dictation into the box is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** The thread whose agent's words the box stands Reply over, quoting them in. */
  replyScope: RefObject<HTMLElement | null>;
  /** Brings the item's agent back from the archive, offered after a send it refused for being archived. */
  onUnarchiveAgent: () => Promise<ActionResult>;
}

/** One item's box, its editor, its lists, its dictation, and what its note says all its own. */
function AnswerCard({
  item,
  readerId,
  control,
  agent,
  thread,
  controls,
  skills,
  keywords,
  replyScope,
  onUnarchiveAgent,
  statuses,
}: AnswerBoxProps & { statuses: IntegrationStatuses }): React.JSX.Element {
  const toast = useToast();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // Whether the last paste was cut to the room the box has left, until the words change again.
  const [cut, setCut] = useState(false);
  const draft = control.draftOf(item);
  const sending = control.sending.has(item.id);
  // Note that the answer waits while files are read, and files read while a message lands on the item land in its box all the same, as its words stand.
  const files = useAttachedFiles({
    holder: {
      attachments: draft.attachments,
      update: (next) => control.onAttachments(item, next),
    },
    onRefusal: setRefusal,
  });
  // Note that a notice opening acknowledges offers no Got it, since opening it was the nod (`useNodOnOpen`), save while its holder's held read has failed, when opening acknowledges nothing.
  const nodded = acknowledgedOnOpen(item, readerId) && !control.failed;
  // Note that a notice addressed to nobody offers no Got it, since it is only read.
  const nod = asksNod(item, readerId) && emptyBox(draft) && !nodded;
  const held = sending || files.reading;
  // Note that Send lights only where the box holds a reply the service takes: an answer to the open ask attached, or words or files, a notice's nod being Got it's.
  const sendable = nod || inboxThreadSend(thread, draft) !== undefined;
  const asks = controls !== undefined;
  const placeholder = answerPlaceholder(asks, undefined);
  const field = useAnswerField({
    draft: draft.note,
    placeholder,
    self: item.agentId,
    agent,
    skills,
    keywords,
    statuses,
    onNote: setRefusal,
  });
  const { editor, room, module } = field;
  const { dictating } = field.pickers;
  const kept = control.notes.get(item.id);
  const noted = kept === undefined ? undefined : inboxNoteReading(kept, agent);
  const note =
    noted?.words ??
    refusal ??
    (cut ? pasteCutWords(INBOX_BOUNDS.MAX_MESSAGE_CHARS) : undefined) ??
    (field.failed ? EDITOR_LOAD_FAILED : undefined);
  // Note that the note is let go once the agent is back, since what it said no longer stands, and only that note, never one a later send left meanwhile.
  const unarchive = () =>
    void onUnarchiveAgent().then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({ words: result.reason, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
      } else if (kept !== undefined) control.onDropNote(item.id, kept);
    });
  const message = () => {
    setRefusal(undefined);
    setCut(false);
    control.onMessage(item, draft);
  };
  const acknowledge = () => {
    setRefusal(undefined);
    setCut(false);
    control.onAcknowledge(item);
  };
  // Note that Reply stands only while the editor stands and takes a quote, and no send is out, since a press lets the selection go.
  const quotes = !sending && !dictating && module !== undefined;
  return (
    <div className={COMPOSER_ROOM_CLASS} {...files.drop.target}>
      <AnswerForm
        dropping={files.drop.dropping}
        field={field}
        asks={asks}
        messages
        controls={controls}
        chips={
          <AttachedFileChips files={attachmentChips(files.attachments)} onRemove={files.remove} />
        }
        note={draft.note}
        onNote={(text) => {
          setCut(false);
          control.onDraft(item, { ...draft, note: text });
        }}
        onPasteCut={() => {
          // Note that a paste cut says so over a refusal said of what came before it.
          setRefusal(undefined);
          setCut(true);
        }}
        placeholder={placeholder}
        maxLength={INBOX_BOUNDS.MAX_MESSAGE_CHARS}
        onEnter={() => {
          if (room.current !== null) submitPromptInput(room.current);
        }}
        onPasteFiles={files.paste}
        quote={(quote) => <ComposerQuoteView quote={quote} held={false} />}
        tools={<AttachFilesButton onFiles={files.attach} />}
        says={
          note === undefined
            ? undefined
            : noted?.unarchive === true
              ? { words: note, remedy: { label: UNARCHIVE, onClick: unarchive } }
              : { words: note }
        }
        nod={nod}
        sending={sending}
        held={held}
        sendable={sendable}
        onSubmit={() => {
          if (files.reading) return;
          if (nod) acknowledge();
          else message();
        }}
      />
      {quotes ? (
        <ReplyToSelection
          scope={replyScope}
          onReply={(words) => {
            editor.current?.insertQuote(words);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The box under every item, replying on its thread, open or settled, as above, a note that it was not sent under the
 * card as the composer's is. Each item gets a card of its
 * own, so a dictation, its note, and the editor's undo never follow the
 * developer to another item; where the account's servers stand is read
 * once for every item the pane shows.
 */
export function InboxAnswerBox(props: AnswerBoxProps): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  return <AnswerCard key={props.item.id} {...props} statuses={statuses} />;
}
