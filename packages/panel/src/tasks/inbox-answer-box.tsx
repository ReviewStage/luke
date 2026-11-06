import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AGENT_STATUS, type AgentAttachment, type AgentSummary } from "@repo/features/agent-wire";
import { INBOX_BOUNDS, type InboxItem, type InboxMessage } from "@repo/features/inbox-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import {
  Checkbox,
  ComposerBody,
  ComposerFoot,
  type ComposerNote,
  type ComposerRefusal,
  STATUS_TONE,
} from "@repo/ui";
import { SERVER_HANDED } from "@repo/ui/agent-servers-model";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { PromptInput, submitPromptInput } from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import { useConnected } from "../connection.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses.js";
import { PANEL_SPAN } from "../panel-spans.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerQuote,
  type DescriptionEditorModule,
} from "../description-editor/contract.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { type ComposerPickers, useComposerPickers } from "./composer-pickers.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { focusMissing } from "./inbox-ask-controls.js";
import { type InboxMissing, missingWords } from "./inbox-ask-words.js";
import type { InboxCloser } from "./inbox-close.js";
import {
  acknowledgedOnOpen,
  awaitsNod,
  type InboxDraft,
  inboxMissing,
  inboxNoteReading,
  inboxThreadSend,
} from "./inbox-model.js";
import { ComposerQuoteView, ReplyToSelection } from "./reply-to-selection.js";
import type { SkillSource } from "./skill-picker.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

function emptyBox(draft: InboxDraft): boolean {
  return draft.note.trim() === "" && draft.attachments.length === 0;
}

const NOTE_PLACEHOLDER = "Add a note";

const REPLY_PLACEHOLDER = "Reply";

const EDITOR_LOAD_FAILED = "The answer box could not be loaded.";

const SEND = "Send";

const SENDING = "Sending";

const RESOLVE_PLACEHOLDER = "Tell the agent why (optional)";

const START_THREAD = "Start thread";

const NEW_THREAD_PLACEHOLDER = "Start a new thread";

const SEND_AS_NEW = "Send as a new thread to";

const GOT_IT = "Got it";

const UNARCHIVE = "Unarchive";

function answerPlaceholder(asks: boolean, own: string | undefined): string {
  if (asks) return NOTE_PLACEHOLDER;
  return own ?? REPLY_PLACEHOLDER;
}

interface AnswerField {
  readonly editor: RefObject<ComposerEditorHandle | undefined>;
  readonly room: RefObject<HTMLDivElement | null>;
  readonly module: DescriptionEditorModule | undefined;
  readonly failed: boolean;
  readonly reload: () => void;
  readonly pickers: ComposerPickers;
}

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
  self: string | undefined;
  agent: AgentSummary | undefined;
  skills: SkillSource | undefined;
  keywords: readonly string[];
  statuses: IntegrationStatuses;
  onNote: (note: string | undefined) => void;
}): AnswerField {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const { descriptionEditor } = useSideBundles();
  const bundle = useAtomValue(descriptionEditor);
  const reload = useAtomRefresh(descriptionEditor);
  const pickers = useComposerPickers({
    editor,
    room,
    draft,
    placeholder,
    self,
    skills,
    keywords,
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed: agent?.status === AGENT_STATUS.RUNNING ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    onNote,
  });
  return {
    editor,
    room,
    module: AsyncResult.isSuccess(bundle) ? bundle.value : undefined,
    failed: AsyncResult.isFailure(bundle),
    reload,
    pickers,
  };
}

interface AnswerFormProps {
  readonly field: AnswerField;
  readonly asks: boolean;
  readonly messages: boolean;
  readonly controls: React.ReactNode;
  readonly chips?: React.ReactNode;
  readonly note: string;
  readonly onNote: (note: string) => void;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly onEnter: () => void;
  readonly onPasteFiles?: ((files: readonly File[]) => boolean) | undefined;
  readonly onPasteCut?: (() => void) | undefined;
  readonly quote?: ((quote: ComposerQuote) => React.ReactNode) | undefined;
  readonly tools?: React.ReactNode;
  readonly says?: ComposerNote | undefined;
  readonly nod: boolean;
  readonly starts?: boolean | undefined;
  readonly sending: boolean;
  readonly held: boolean;
  readonly sendable: boolean;
  readonly refuses?: ComposerRefusal | undefined;
  readonly onSubmit: () => void;
  readonly dropping?: boolean | undefined;
}

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
  starts = false,
  sending,
  held,
  sendable,
  refuses,
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
      <ComposerBody files={chips}>
        <ComposerField
          keystrokeSpan={PANEL_SPAN.KEYSTROKE_INBOX_ANSWER}
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
          label: nod ? GOT_IT : starts ? START_THREAD : SEND,
          inWords: nod || starts,
          empty: !sendable,
          held,
          busy: sending,
          busyLabel: SENDING,
          refuses,
        }}
        note={says}
      />
    </PromptInput>
  );
}

function NewThreadChoice({
  offer,
  checked,
  held,
  onChange,
}: {
  offer: AnswerNewThread;
  checked: boolean;
  held: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="inbox-new-thread flex min-w-0 pt-ui-8 pl-ui-4 text-muted-foreground">
      <Checkbox checked={checked} disabled={held} onChange={onChange}>
        {SEND_AS_NEW} {offer.agent}
      </Checkbox>
    </div>
  );
}

function takesNoFiles(): boolean {
  return false;
}

interface AnswerBoxProps {
  item: InboxItem;
  readerId: string | undefined;
  control: TaskInboxControl;
  agent: AgentSummary | undefined;
  thread: readonly InboxMessage[];
  controls: React.ReactNode;
  resolver?: InboxCloser | undefined;
  skills: SkillSource | undefined;
  keywords: readonly string[];
  replyScope: RefObject<HTMLElement | null>;
  onQuoteDoor?: ((door: ((words: string) => void) | undefined) => void) | undefined;
  onUnarchiveAgent: () => Promise<ActionResult>;
  newThread?: AnswerNewThread | undefined;
}

export interface NewThreadStart {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly clientKey: string;
}

export interface AnswerNewThread {
  readonly agent: ReactNode;
  readonly onStart: (start: NewThreadStart) => Promise<string | undefined>;
}

function AnswerCard({
  item,
  readerId,
  control,
  agent,
  thread,
  controls,
  resolver,
  skills,
  keywords,
  replyScope,
  onQuoteDoor,
  onUnarchiveAgent,
  newThread,
  statuses,
}: AnswerBoxProps & { statuses: IntegrationStatuses }): React.JSX.Element {
  const connected = useConnected();
  const toast = useToast();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [filesRefused, setFilesRefused] = useState(false);
  const [cut, setCut] = useState(false);
  const draft = control.draftOf(item);
  const [asNew, setAsNew] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const attempt = useRef<{ readonly key: string; readonly words: string } | undefined>(undefined);
  const starts = newThread !== undefined && asNew;
  const resolves = resolver !== undefined && !starts;
  const asks = controls !== undefined && !starts;
  const standing = useRef(draft);
  standing.current = draft;
  const sending = control.sending.has(item.id) || starting || closing;
  const files = useAttachedFiles({
    holder: {
      attachments: draft.attachments,
      update: (next) => control.onAttachments(item, next),
    },
    onRefusal: (words) => {
      setRefusal(words);
      setFilesRefused(words !== undefined);
    },
  });
  const nodded = acknowledgedOnOpen(item, readerId) && !control.failed;
  const nod = awaitsNod(item) && emptyBox(draft) && !nodded && !starts;
  const held = sending || files.reading;
  const sendable =
    starts || resolves
      ? (resolves || !emptyBox(draft)) && draft.note.trim().length <= INBOX_BOUNDS.MAX_MESSAGE_CHARS
      : nod || inboxThreadSend(thread, draft) !== undefined;
  const missing = starts || nod || resolves ? undefined : inboxMissing(thread, draft);
  const [wanting, setWanting] = useState(false);
  if (wanting && missing === undefined) setWanting(false);
  const box = useRef<HTMLDivElement>(null);
  const refuse = (lacks: InboxMissing) => {
    setWanting(true);
    focusMissing(box.current, lacks);
  };
  const placeholder = starts
    ? NEW_THREAD_PLACEHOLDER
    : resolves
      ? RESOLVE_PLACEHOLDER
      : answerPlaceholder(asks, undefined);
  const field = useAnswerField({
    draft: draft.note,
    placeholder,
    self: item.agentId,
    agent,
    skills,
    keywords,
    statuses,
    onNote: (words) => {
      setRefusal(words);
      setFilesRefused(false);
    },
  });
  const { editor, room, module } = field;
  const { dictating } = field.pickers;
  const kept = control.notes.get(item.id);
  const noted = kept === undefined ? undefined : inboxNoteReading(kept, agent, connected);
  const note =
    noted?.words ??
    refusal ??
    (cut ? pasteCutWords(INBOX_BOUNDS.MAX_MESSAGE_CHARS) : undefined) ??
    (field.failed ? EDITOR_LOAD_FAILED : undefined);
  const noteFailure =
    noted === undefined && (refusal === undefined ? cut : filesRefused)
      ? UNREPORTED.INPUT
      : noted === undefined && refusal === undefined && field.failed
        ? unreadShown(FAILURE_SURFACE.BUNDLE_LOAD)
        : failureShown({
            surface: FAILURE_SURFACE.INBOX_ANSWER,
            cause: FAILURE_CONDITION.REFUSED,
            about: { inboxItemId: item.id },
            refused: true,
          });
  const unarchive = () =>
    void onUnarchiveAgent().then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({
          replayUnmasked: true,
          words: result.reason,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: {
            surface: FAILURE_SURFACE.AGENT_ARCHIVE,
            cause: result,
            about: { inboxItemId: item.id, agentId: item.agentId },
          },
        });
      } else if (kept !== undefined) control.onDropNote(item.id, kept);
    });
  const message = () => {
    setRefusal(undefined);
    setCut(false);
    control.onMessage(item, draft);
  };
  const resolve = (closer: InboxCloser) => {
    setRefusal(undefined);
    setCut(false);
    const note = { text: draft.note, attachments: draft.attachments };
    if (emptyBox(draft)) {
      void closer(item);
      return;
    }
    setClosing(true);
    control.onDraft(item, { ...draft, note: "", attachments: [] });
    void closer(item, undefined, note).then((closed) => {
      setClosing(false);
      if (closed.kept) return;
      const now = standing.current;
      control.onDraft(item, {
        ...now,
        note: [note.text, now.note].filter((words) => words !== "").join("\n"),
        attachments: [...note.attachments, ...now.attachments],
      });
    });
  };
  const acknowledge = () => {
    setRefusal(undefined);
    setCut(false);
    control.onAcknowledge(item);
  };
  const start = (offer: AnswerNewThread) => {
    const sent = { note: draft.note, attachments: draft.attachments };
    const text = sent.note.trim();
    const words = JSON.stringify([text, sent.attachments]);
    const key = attempt.current?.words === words ? attempt.current.key : crypto.randomUUID();
    attempt.current = { key, words };
    setRefusal(undefined);
    setCut(false);
    setStarting(true);
    control.onDraft(item, { ...draft, note: "", attachments: [] });
    void offer.onStart({ text, attachments: sent.attachments, clientKey: key }).then((refused) => {
      setStarting(false);
      if (refused === undefined) {
        attempt.current = undefined;
        setAsNew(false);
        return;
      }
      setRefusal(refused);
      setFilesRefused(false);
      if (emptyBox(standing.current)) control.onDraft(item, { ...standing.current, ...sent });
    });
  };
  const quotes = !sending && !dictating && module !== undefined;
  useEffect(() => {
    if (onQuoteDoor === undefined || !quotes) return undefined;
    onQuoteDoor((words) => editor.current?.insertQuote(words));
    return () => onQuoteDoor(undefined);
  }, [onQuoteDoor, quotes]);
  return (
    <div ref={box} className={COMPOSER_ROOM_CLASS} {...files.drop.target}>
      <AnswerForm
        dropping={files.drop.dropping}
        field={field}
        asks={asks}
        messages
        controls={asks ? controls : undefined}
        chips={
          <AttachedFileChips files={attachmentChips(files.attachments)} onRemove={files.remove} />
        }
        note={draft.note}
        onNote={(text) => {
          setCut(false);
          control.onDraft(item, { ...draft, note: text });
        }}
        onPasteCut={() => {
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
              ? {
                  words: note,
                  failure: noteFailure,
                  remedy: { label: UNARCHIVE, onClick: unarchive },
                }
              : {
                  words: note,
                  failure: noteFailure,
                  onRetry: note === EDITOR_LOAD_FAILED ? field.reload : undefined,
                }
        }
        nod={nod}
        starts={starts}
        sending={sending}
        held={held}
        sendable={sendable}
        refuses={
          missing === undefined
            ? undefined
            : {
                onRefused: () => refuse(missing),
                words: wanting ? missingWords(missing) : undefined,
              }
        }
        onSubmit={() => {
          if (files.reading) return;
          if (starts) start(newThread);
          else if (resolver !== undefined) resolve(resolver);
          else if (nod) acknowledge();
          else if (missing !== undefined) refuse(missing);
          else message();
        }}
      />
      {newThread === undefined ? null : (
        <NewThreadChoice offer={newThread} checked={asNew} held={sending} onChange={setAsNew} />
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

export function InboxAnswerBox(props: AnswerBoxProps): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  return <AnswerCard key={props.item.id} {...props} statuses={statuses} />;
}
