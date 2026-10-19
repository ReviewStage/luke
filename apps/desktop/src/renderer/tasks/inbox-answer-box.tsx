import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_BOUNDS,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxItem,
  type InboxReadResponse,
  knownResponse,
} from "@luke/features/inbox-wire";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "@luke/panel/ai-elements/prompt-input";
import { useSideBundles } from "@luke/panel/bundle-loader";
import { imageFiles } from "@luke/panel/feedback-images";
import { type IntegrationStatuses, useIntegrationStatuses } from "@luke/panel/integration-statuses";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "@luke/panel/plan-editor/contract";
import { readFiles, withFiles } from "@luke/panel/tasks/attached-files";
import { ComposerField } from "@luke/panel/tasks/composer-field";
import { DictateButton, DictationStrip } from "@luke/panel/tasks/dictation-strip";
import { ComposerQuoteView, ReplyToSelection } from "@luke/panel/tasks/reply-to-selection";
import { Tooltip } from "@luke/panel/tooltip";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  IconButton,
  PlusIcon,
  SUBMIT_STATE,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { SERVER_HANDED } from "@luke/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type RefObject, useRef, useState } from "react";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips";
import { useComposerPickers } from "./composer-pickers";
import {
  type InboxDraft,
  type InboxMissing,
  inboxMessageOf,
  inboxMissing,
  inboxReply,
  pickedWords,
} from "./inbox-model";
import type { SkillSource } from "./skill-picker";
import type { TaskInboxControl } from "./use-task-inbox";

/**
 * inbox-answer-box.tsx -- the box docked under every Inbox item's thread: the agent's message box's card and field, answering an open item with its one Send at its foot, and writing a message on a settled one's thread.
 *
 * The box is the agent composer's card (`ai-elements/prompt-input.tsx`)
 * around the agent composer's field (`composer-field.tsx`), and takes what
 * that box takes, through the same pickers (`composer-pickers.tsx`): an `@`
 * opens the list of what the note may mention, where the page hands
 * mentions, the plan's own on a plan's Inbox and the item's repository's
 * in the window's, each written in as its link and drawn as its chip; a `/`
 * opens the repository's skills; and the microphone left of the send
 * records words into the box at the caret, in place of the foot until ✓
 * or Enter, or ✕ or Escape. The note goes to the agent in the "Inbox
 * answer" message as it was written, links and all, so what a mention names
 * reaches the agent as a message's does. Enter sends, Shift+Enter is a new
 * line, and Escape leaves the box, as in the agent's box; Enter, or Send,
 * on an answer that lacks something sends nothing, and says what it lacks
 * on the quiet line, "Pick an option", taking the keyboard there, while a
 * choice of several counts its picks there. Files go with an
 * answer as they go with a message (`attached-files.ts`): the "+" at the
 * foot's left opens the system's file picker, an image pasted into the box
 * is taken, and files dropped on the card are, each drawn as a chip above
 * the words with its way off; a file that cannot come says why under the
 * card. Files stand for the developer's own words where they wrote none,
 * and while they are read the answer waits for them. Every item is sent
 * by the one Send at the foot's right, its pick made in the question above;
 * a note's reads "Got it" while the box holds nothing, and "Send" once it
 * does. Unlike the agent's box, the field never takes the
 * caret as an item opens, because K and J step the list while the caret
 * is elsewhere.
 *
 * Words selected in the agent's part of the thread and answered with Reply
 * are laid into the box as a quote block where the caret stands, the box
 * then taking the caret, as the agent's own box takes them
 * (`reply-to-selection.tsx`); a quote goes out as a Markdown blockquote,
 * part of the answer or the message like any other words. The box stands
 * Reply itself, over the thread it is handed, and only while its editor is
 * loaded and takes a quote, never while an answer is out or a dictation
 * holds it, since a press lets the selection go.
 *
 * A card whose agent need not hear back says whether its answer will
 * message the agent: a bare answer does not, and a typed note or an attached
 * file does. Why an answer did not go, a file did not come, or a dictation
 * left nothing, is said under the card.
 *
 * Once the item is settled, answered or taken back, the same box writes a
 * message on its thread instead, "Message <agent>…": words, files, or
 * both, sent by Send or Enter, which reach the agent and leave the item
 * where it stands. While the item waits, its words are its answer, never a
 * message beside it, so an open item is answered as it always was.
 */

/** What a card's box asks for, by what the item asks; a text's own placeholder stands where the agent wrote one. */
const NOTE_PLACEHOLDER = {
  [INBOX_RESPONSE.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_RESPONSE.APPROVAL]: "Add a note for the agent",
  [INBOX_RESPONSE.TEXT]: "Your answer",
  [INBOX_RESPONSE.TODO]: "Add a note for the agent",
  [INBOX_RESPONSE.FORM]: "Add a note for the agent",
  [INBOX_RESPONSE.NONE]: "Add a note for the agent",
} as const;

/** What the card says in the box's place where the item asks something this build does not know. */
const NEWER_LUKE = "Answer this in a newer Luke.";

/** What the note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The answer box could not be loaded.";

/**
 * What the box says on an item whose agent need not hear back: a bare
 * answer, Done or Got it, is kept for the agent to read, and a typed note is
 * sent to it as a message, so the line says which the answer will be.
 */
const QUIET_LINE = {
  BARE: "Without a note, this won't message the agent.",
  NOTED: "Your note will be sent to the agent.",
  FILES: "Your answer and its files will be sent to the agent.",
} as const;

/** What the box's Send is called. */
const SEND = "Send to agent";

/** What the box's Send is called on a settled item, where it writes a message on the thread. */
const SEND_MESSAGE = "Send";

/** What a settled item's box asks for: a message to its agent, by name. */
function messagePlaceholder(agentName: string): string {
  return `Message ${agentName}…`;
}

/** What the box says of files read for an item its agent changed before they landed. */
const ITEM_CHANGED = "The agent changed this item while your files were read. Attach them again.";

/** What the box's + is called, which is its tooltip too. */
const ATTACH = "Attach files";

/** Whether a drag carries files, which is all the card takes from one. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/** What the quiet line says of the answer as the card holds it: whether its files or its note go to the agent, or nothing does. */
function quietLine(draft: InboxDraft): string {
  if (draft.attachments.length > 0) return QUIET_LINE.FILES;
  return draft.note.trim() === "" ? QUIET_LINE.BARE : QUIET_LINE.NOTED;
}

/**
 * What the quiet line says of an open item, first what holds: what a send
 * found the answer lacking, while it still lacks it; how many options a
 * choice of several has picked; and, where the agent need not hear back,
 * whether the answer will message it.
 */
function openQuietLine(
  item: InboxItem,
  draft: InboxDraft,
  wanting: string | undefined,
): { readonly line: string; readonly wanting: boolean } | undefined {
  if (wanting !== undefined && inboxMissing(item, draft)?.line === wanting) {
    return { line: wanting, wanting: true };
  }
  const response = item.response;
  if (
    knownResponse(response) &&
    response.type === INBOX_RESPONSE.CHOICE &&
    response.multiple === true
  ) {
    return { line: pickedWords(draft.choices.length), wanting: false };
  }
  return item.needsReply ? undefined : { line: quietLine(draft), wanting: false };
}

/** What a note's Send says while no word is written, the nod that answers it, and once one is. */
const NOTE_SEND = {
  NOD: "Got it",
  WORDS: "Send",
} as const;

/**
 * The Send that ends every open item's box: the round send of words, a
 * choice, a form, an approval, and a to-do, held while the answer lacks
 * something, since its Enter says what; a note's, which it always takes,
 * in words, "Got it" while the box holds nothing and "Send" once it does.
 */
function AnswerSend({
  item,
  draft,
  sending,
  reading,
}: {
  item: InboxItem;
  draft: InboxDraft;
  sending: boolean;
  /** Whether files handed to the box are still being read, which the answer waits for. */
  reading: boolean;
}): React.JSX.Element {
  const held = sending || reading;
  if (item.response.type === INBOX_RESPONSE.NONE) {
    const said = draft.note.trim() === "" && draft.attachments.length === 0;
    return (
      <Button
        type={BUTTON_TYPE.SUBMIT}
        variant={BUTTON_VARIANT.PRIMARY}
        busy={sending}
        busyLabel="Sending"
        disabled={held}
      >
        {said ? NOTE_SEND.NOD : NOTE_SEND.WORDS}
      </Button>
    );
  }
  return (
    <Tooltip label={SEND}>
      <PromptInputSubmit
        label={SEND}
        status={sending ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.READY}
        disabled={held || inboxReply(item, draft) === undefined}
      />
    </Tooltip>
  );
}

/** What the card's box asks for: the agent's own placeholder on a text, its response's words otherwise. */
function placeholderOf(response: InboxReadResponse): string {
  if (!knownResponse(response)) return "";
  if (response.type === INBOX_RESPONSE.TEXT && response.placeholder !== undefined) {
    return response.placeholder;
  }
  return NOTE_PLACEHOLDER[response.type];
}

/** What an item's box is drawn with, beside where the account's servers stand. */
interface AnswerBoxProps {
  item: InboxItem;
  control: TaskInboxControl;
  /** The item's agent as its holder's read lists it, whose servers' switches a server's chip reads; none before the read lands. */
  agent: CodingAgentSummary | undefined;
  /** The agent's name as the thread names it, which a settled item's box asks to message. */
  agentName: string;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  skills: SkillSource | undefined;
  /** The words a dictation into the box is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** The thread whose agent's words the box stands Reply over, quoting them in. */
  replyScope: RefObject<HTMLElement | null>;
  /** Takes the keyboard to what a send found the answer lacking, in the item's question or in the box. */
  onMissing: (missing: InboxMissing) => void;
}

/** One item's box, its editor, its lists, its dictation, and what its note says all its own. */
function AnswerCard({
  item,
  control,
  agent,
  agentName,
  skills,
  keywords,
  replyScope,
  onMissing,
  statuses,
}: AnswerBoxProps & { statuses: IntegrationStatuses }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  // What the last send found the answer lacking, which the quiet line says until it is filled.
  const [wanting, setWanting] = useState<string | undefined>(undefined);
  // How many hand-offs of files are still being read, during which the answer waits.
  const [reading, setReading] = useState(0);
  const draft = control.draftOf(item);
  const sending = control.sending.has(item.id);
  // Note that the item is read through a ref, because reading files takes a
  // while and the item they land on is whichever revision is current by then.
  const latest = useRef(item);
  latest.current = item;
  // Note that a settled item's box writes a message on its thread, which no response shapes.
  const answering = item.status === INBOX_STATUS.OPEN;
  // Note that a note's Send is its words, which the narrow card keeps in the foot rather than at the field's end.
  const namedSend = answering && item.response.type === INBOX_RESPONSE.NONE;
  const placeholder = answering ? placeholderOf(item.response) : messagePlaceholder(agentName);
  const bundle = useAtomValue(useSideBundles().planEditor);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  const pickers = useComposerPickers({
    editor,
    room,
    draft: draft.note,
    placeholder,
    self: item.agentId,
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
    onNote: setRefusal,
  });
  const { dictation, dictating } = pickers;
  const note =
    control.notes.get(item.id) ??
    refusal ??
    (AsyncResult.isFailure(bundle) ? EDITOR_LOAD_FAILED : undefined);
  const answer = () => {
    setRefusal(undefined);
    control.onAnswer(item, draft);
  };
  // A send of an answer that lacks something goes nowhere: it says what, and takes the keyboard there.
  const send = () => {
    const missing = inboxReply(item, draft) === undefined ? inboxMissing(item, draft) : undefined;
    if (missing === undefined) {
      answer();
      return;
    }
    setWanting(missing.line);
    onMissing(missing);
  };
  const message = () => {
    setRefusal(undefined);
    control.onMessage(item, draft);
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || sending) return;
    const { revision } = item;
    setReading((count) => count + 1);
    readFiles(files)
      .then((read) => {
        // Files read for an item its agent changed meanwhile land nowhere, as its words were let go.
        const now = latest.current;
        if (now.revision !== revision) {
          setRefusal(ITEM_CHANGED);
          return;
        }
        // Taken after whatever the card holds as the write lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        let refusal = read.refusal;
        control.onAttachments(now, (was) => {
          const taken = withFiles(was, read);
          refusal = taken.refusal;
          return taken.attachments;
        });
        setRefusal(refusal);
      })
      .finally(() => setReading((count) => count - 1));
  };
  const quiet = answering ? openQuietLine(item, draft, wanting) : undefined;
  const takes = !answering || knownResponse(item.response);
  const takesFiles = takes && !sending;
  // Note that Reply stands only while the editor stands and takes a quote, since a press lets the selection go.
  const quotes = takes && !sending && !dictating && module !== undefined;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a drop target alone; the keys it hears come from its own field and buttons.
    <div
      className="agent-composer"
      data-dropping={dropping ? "" : undefined}
      onDragOver={(event) => {
        if (!carriesFiles(event) || !takesFiles) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // A drag moving onto one of the card's own children has not left it.
        const into = event.relatedTarget;
        if (!(into instanceof Node && event.currentTarget.contains(into))) setDropping(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event) || !takesFiles) return;
        event.preventDefault();
        setDropping(false);
        attach(Array.from(event.dataTransfer.files));
      }}
    >
      {takes ? (
        <PromptInput
          className="inbox-answer"
          data-named-send={namedSend ? "" : undefined}
          data-messages={answering ? undefined : ""}
          onSubmit={() => {
            if (reading > 0) return;
            if (answering) send();
            else message();
          }}
        >
          <AttachedFileChips
            files={attachmentChips(draft.attachments)}
            onRemove={
              sending
                ? undefined
                : (index) => {
                    setRefusal(undefined);
                    control.onAttachments(item, (was) => was.filter((_, at) => at !== index));
                  }
            }
          />
          <ComposerField
            module={module}
            editor={editor}
            room={room}
            draft={draft.note}
            setDraft={(text) => control.onDraft(item, { ...draft, note: text })}
            placeholder={placeholder}
            label={placeholder}
            input={
              sending
                ? COMPOSER_INPUT.DISABLED
                : dictating
                  ? COMPOSER_INPUT.READ_ONLY
                  : COMPOSER_INPUT.EDITABLE
            }
            maxLength={answering ? INBOX_BOUNDS.MAX_NOTE_CHARS : INBOX_BOUNDS.MAX_MESSAGE_CHARS}
            takesFocus={false}
            {...pickers.field}
            onEnter={() => {
              if (room.current === null) return;
              // Note that an answer's Enter sends whatever Send would say, since an answer that lacks something is told what.
              if (answering) room.current.closest("form")?.requestSubmit();
              else submitPromptInput(room.current);
            }}
            onPasteFiles={(files) => {
              // Only images are taken from the clipboard; text pastes as it always does.
              const pasted = imageFiles(files);
              if (pasted.length === 0) return false;
              attach(pasted);
              return true;
            }}
            quote={(quote) => <ComposerQuoteView quote={quote} held={sending} />}
          />
          <PromptInputFooter className="inbox-answer-foot">
            {dictating ? (
              <DictationStrip dictation={dictation} />
            ) : (
              <>
                <PromptInputTools className="inbox-answer-tools">
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
                    multiple
                    hidden
                    onChange={(event) => {
                      const picked = Array.from(event.currentTarget.files ?? []);
                      // Cleared so the same file can be picked again after it was taken off.
                      event.currentTarget.value = "";
                      attach(picked);
                    }}
                  />
                  <span className="inbox-answer-quiet">
                    {quiet === undefined ? null : (
                      <span
                        data-inbox-quiet=""
                        data-wanting={quiet.wanting ? "" : undefined}
                        role={quiet.wanting ? "status" : undefined}
                      >
                        {quiet.line}
                      </span>
                    )}
                  </span>
                </PromptInputTools>
                <div className="inbox-answer-actions">
                  <DictateButton dictation={dictation} disabled={sending || module === undefined} />
                  {answering ? (
                    <AnswerSend item={item} draft={draft} sending={sending} reading={reading > 0} />
                  ) : (
                    <Tooltip label={SEND_MESSAGE}>
                      <PromptInputSubmit
                        label={SEND_MESSAGE}
                        status={sending ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.READY}
                        disabled={sending || reading > 0 || inboxMessageOf(draft) === undefined}
                      />
                    </Tooltip>
                  )}
                </div>
              </>
            )}
          </PromptInputFooter>
        </PromptInput>
      ) : (
        <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE}</Text>
      )}
      {note === undefined ? null : (
        <p className="error-message agent-composer-note" role="alert">
          {note}
        </p>
      )}
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
 * The box under every item, answering an open one and writing a message on
 * a settled one's thread, as above, a note that it was not sent under the
 * card as the composer's is. Each item gets a card of its
 * own, so a dictation, its note, and the editor's undo never follow the
 * developer to another item; where the account's servers stand is read
 * once for every item the pane shows.
 */
export function InboxAnswerBox(props: AnswerBoxProps): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  return <AnswerCard key={props.item.id} {...props} statuses={statuses} />;
}
