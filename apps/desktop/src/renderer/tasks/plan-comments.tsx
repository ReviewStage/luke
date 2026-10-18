import { useAtomValue } from "@effect/atom-react";
import { LINK_PLACE } from "@luke/features/luke-link";
import { textChange } from "@luke/features/plan-comment-anchor";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentEntry,
  type PlanCommentThread,
  type PlanCommentWriter,
} from "@luke/features/plan-comment-wire";
import type { PlanSection } from "@luke/features/plan-document";
import { ActorMark, ActorRef } from "@luke/panel/actor-ref";
import { useSideBundles } from "@luke/panel/bundle-loader";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { ActionMenu, type MenuAction } from "@luke/panel/desktop/action-menu";
import { MarkdownMessage } from "@luke/panel/markdown-message";
import { usePerson } from "@luke/panel/member-directory";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type EditorSpan,
  type PlanEditorHandle,
  type PlanEditorModule,
} from "@luke/panel/plan-editor/contract";
import { ComposerField } from "@luke/panel/tasks/composer-field";
import { DictateButton, DictationStrip } from "@luke/panel/tasks/dictation-strip";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useMinute } from "@luke/panel/tasks/task-time";
import {
  DICTATION_PHASE,
  type DictationControl,
  useDictation,
} from "@luke/panel/tasks/use-dictation";
import { useKnownNames } from "@luke/panel/tasks/use-known-names";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import { Tooltip } from "@luke/panel/tooltip";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CommentsIcon,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  SUBMIT_STATE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { type Actor, LUKE_ACTOR } from "@luke/ui/actor-model";
import {
  marginTops,
  openThread,
  PENDING_THREAD,
  type PendingThread,
  type PlanCommentsControl,
  usePlanCommentsControl as usePlanCommentsControlOrUndefined,
} from "@luke/ui/plan-comments";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  CheckIcon,
  CircleCheckIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref";
import type { EditAgents } from "./edit-ref";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker";
import { type TaskMentionsValue, useMentionLink, useTaskMentions } from "./task-mentions";

/**
 * plan-comments.tsx -- comments on the open plan, beside its words: each open thread in the margin level with the words it is on, or behind a count at the line's end where the column has no room for a margin, a thread started from words selected or from a block's own button, and each thread answered, resolved, reopened, edited, and deleted where it stands.
 *
 * The words a thread is on are marked in the read view (`plan-body.tsx`
 * draws them through `markdown-message.tsx`'s comment marks), each mark
 * naming its thread, and the margin stands each card level with its mark,
 * the open one exactly so and the rest stepped aside so none overlap
 * (`@luke/ui/plan-comments`'s `marginTops`). A thread whose words were
 * deleted stands at the top of the section they stood in, saying so over
 * its quote. Where the document's column is narrower than the plan's
 * reading width, a margin, and the gap between them, the margin folds: each
 * line holding marks wears a count at its end, which opens its thread as a
 * card floating under the words.
 *
 * A thread is started from words selected in the read view, with the
 * bubble that rises over them, or from the button a block shows at its end
 * under the pointer, which comments on the whole block. Its words are
 * measured in the plan's Markdown by laying the words drawn over the
 * section's source (`@luke/features/plan-comment-anchor`), so emphasis, a
 * link, or a chip inside them puts nothing off. Posting a comment asks no
 * agent anything.
 */

/** The column's room a margin needs beside the reading width: the gap and the card, as `planning.css` spends them. */
const MARGIN_ROOM = 48 + 288;

/** The page's inset on each side of the document, as `--page-inset` spends it. */
const PAGE_INSETS = 2 * 40;

/** The reading width, as `--luke-page-measure` spends it. */
const READING_WIDTH = 720;

/** The class the words a thread is on wear in the read view (`markdown-message.tsx`'s comment mark). */
const COMMENT_MARK_CLASS = "plan-comment-mark";

/** How far below the scroller's top a thread asked to be shown lands. */
const REVEAL_ROOM = 96;

/** How far apart two cards of the margin stand. */
const CARD_GAP = 8;

/** The words a thread's controls are named by. */
const COMMENT_WORDS = {
  COMMENT: "Comment",
  ADD: "Add a comment",
  REPLY: "Reply",
  RESOLVE: "Resolve",
  REOPEN: "Reopen",
  MORE: "More",
  EDIT: "Edit",
  DELETE: "Delete",
  DELETE_THREAD: "Delete thread",
  SAVE: "Save",
  CANCEL: "Cancel",
  GONE: "Original content deleted",
  RESOLVED_IT: "resolved this",
  REOPENED_IT: "reopened this",
  EDITED: "edited",
  OPEN_THREAD: "Open thread",
  SHOW_WORDS: "Show in the plan",
} as const;

/** Which thread is open, and the one being started, shared by the marks that open them and the margin that draws them. */
interface CommentFocus {
  readonly active: string | undefined;
  readonly onActive: (thread: string | undefined) => void;
  readonly pending: PendingThread | undefined;
  /** Opens a thread and asks the plan to scroll to its words, as the Comments tab and a link to it do. */
  readonly reveal: (thread: string) => void;
  /** The last ask to scroll to a thread, counted so the same thread asked twice scrolls twice. */
  readonly revealed: { readonly thread: string; readonly ask: number } | undefined;
}

const CommentFocusContext = createContext<CommentFocus>({
  active: undefined,
  onActive: () => undefined,
  pending: undefined,
  reveal: () => undefined,
  revealed: undefined,
});

/** Where the plan's comments are drawn: which thread is open, and the one being started. */
export function useCommentFocus(): CommentFocus {
  return useContext(CommentFocusContext);
}

/** Who wrote an entry, as every place naming an actor draws them. */
function WriterRef({
  writer,
  agents,
}: {
  writer: PlanCommentWriter;
  agents: EditAgents | undefined;
}): ReactNode {
  const person = usePerson(writer.by);
  if (writer.actor === PLAN_COMMENT_ACTOR.LUKE) return <ActorRef actor={LUKE_ACTOR} />;
  if (
    writer.actor === PLAN_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    const { agentId } = writer;
    const subject = agentSubject(agents.control, agentId, NOTHING_HELD, false);
    return (
      <AgentActorRef
        subject={subject}
        models={agents.control.models}
        onOpen={() => agents.onOpen?.(agentId)}
      />
    );
  }
  return <ActorRef actor={person} />;
}

/** The mark of who wrote an entry, alone, for a thread at rest's faces. */
function WriterMark({
  writer,
  agents,
}: {
  writer: PlanCommentWriter;
  agents: EditAgents | undefined;
}): ReactNode {
  const person = usePerson(writer.by);
  let actor: Actor = person;
  if (writer.actor === PLAN_COMMENT_ACTOR.LUKE) actor = LUKE_ACTOR;
  else if (
    writer.actor === PLAN_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    actor = agentSubject(agents.control, writer.agentId, NOTHING_HELD, false).tile;
  }
  return <ActorMark actor={actor} />;
}

/** Whether the reader wrote an entry, which only its writer edits or deletes. */
function writtenByReader(entry: PlanCommentEntry, me: string | undefined): boolean {
  return (
    entry.writer.actor === PLAN_COMMENT_ACTOR.MEMBER &&
    me !== undefined &&
    entry.writer.by?.userId === me
  );
}

/** A line of what happened to a thread, drawn as a comment's head is: its writer, what they did, and when, level with every name above it. */
function EventLine({
  entry,
  agents,
  now,
}: {
  entry: PlanCommentEntry;
  agents: EditAgents | undefined;
  now: number;
}): React.JSX.Element {
  return (
    <div className="comment-event" data-kind={entry.kind}>
      <div className="comment-head">
        <WriterRef writer={entry.writer} agents={agents} />
        <span className="comment-event-words">
          {` ${entry.kind === PLAN_COMMENT_ENTRY.RESOLVED ? COMMENT_WORDS.RESOLVED_IT : COMMENT_WORDS.REOPENED_IT}`}
        </span>
        <span className="comment-head-end">
          <span className="comment-time">
            <RelativeTime at={entry.at} now={now} ago />
          </span>
        </span>
      </div>
    </div>
  );
}

/** What a thread's controls do, as the card that draws them is handed. */
interface ThreadDoors {
  readonly control: PlanCommentsControl;
  readonly agents: EditAgents | undefined;
  readonly me: string | undefined;
}

/** What deleting asks first, a comment's or a whole thread's, since neither comes back. */
const DELETE_QUESTION: DialogQuestion = {
  title: "Delete this comment?",
  verb: "Delete",
  running: "Deleting…",
  tone: DIALOG_TONE.DANGER,
};

const DELETE_THREAD_QUESTION: DialogQuestion = {
  title: "Delete this thread?",
  body: "Every comment in it is deleted with it.",
  verb: "Delete thread",
  running: "Deleting…",
  tone: DIALOG_TONE.DANGER,
};

/** What a delete that did not land says. */
const COMMENT_NOT_DELETED = "The comment could not be deleted.";

/** One comment of a thread: who wrote it and when, its words, or the field editing them, and its tools under the pointer. */
function CommentEntry({
  thread,
  entry,
  first,
  doors,
  now,
  lead,
}: {
  thread: PlanCommentThread;
  entry: PlanCommentEntry;
  first: boolean;
  doors: ThreadDoors;
  now: number;
  /** What stands between the comment's writer and its words: the thread's quote, under the first comment's name, so the thread's tools keep the card's top corner. */
  lead?: ReactNode;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const deleting = useConfirmDialog({ subject: true, surfaceOpen: true }, async () =>
    (await doors.control.act(
      thread.id,
      first
        ? { action: PLAN_COMMENT_ACTION.DELETE_THREAD }
        : { action: PLAN_COMMENT_ACTION.DELETE, entry: entry.id },
    ))
      ? { status: ACTION_RESULT_STATUS.ACCEPTED }
      : {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: doors.control.notes.get(thread.id) ?? COMMENT_NOT_DELETED,
        },
  );
  const copyLink = useCopyLinkItem()({
    kind: LINK_PLACE.COMMENT,
    planId: doors.control.planId,
    threadId: thread.id,
  });
  const menu = useMenu(true);
  const trigger = menu.trigger();
  const mine = writtenByReader(entry, doors.me);
  const items: MenuAction[] = [
    ...(copyLink === undefined ? [] : [copyLink]),
    ...(mine
      ? [
          {
            label: COMMENT_WORDS.EDIT,
            icon: <PencilIcon aria-hidden="true" />,
            onSelect: () => setEditing(entry.words ?? ""),
          },
        ]
      : []),
    ...(mine && !first
      ? [
          {
            label: COMMENT_WORDS.DELETE,
            icon: <TrashIcon />,
            danger: true,
            onSelect: deleting.ask,
          },
        ]
      : []),
    ...(first
      ? [
          {
            label: COMMENT_WORDS.DELETE_THREAD,
            icon: <TrashIcon />,
            danger: true,
            onSelect: deleting.ask,
          },
        ]
      : []),
  ];
  const settle = first && openThread(thread);
  const save = () => {
    const words = editing?.trim() ?? "";
    if (words === "") return;
    void doors.control
      .act(thread.id, { action: PLAN_COMMENT_ACTION.EDIT, entry: entry.id, words })
      .then((done) => {
        if (done) setEditing(undefined);
      });
  };
  return (
    <div className="comment-entry" data-entry={entry.id}>
      {/* Note that the time and the tools share the row's end, the tools in the time's place under the pointer, so a long name gives way to neither and nothing stands over it. */}
      <div className="comment-head">
        <WriterRef writer={entry.writer} agents={doors.agents} />
        <span className="comment-head-end">
          <span className="comment-time">
            <RelativeTime at={entry.at} now={now} ago />
            {entry.editedAt === undefined ? null : ` · ${COMMENT_WORDS.EDITED}`}
          </span>
          <div className="comment-tools">
            {first ? (
              <Tooltip label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}>
                <IconButton
                  size={BUTTON_SIZE.COMPACT}
                  icon={settle ? <CheckIcon /> : <RotateCcwIcon />}
                  label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}
                  onClick={() =>
                    void doors.control.act(thread.id, {
                      action: settle ? PLAN_COMMENT_ACTION.RESOLVE : PLAN_COMMENT_ACTION.REOPEN,
                    })
                  }
                />
              </Tooltip>
            ) : null}
            <Tooltip label={COMMENT_WORDS.MORE}>
              <IconButton
                size={BUTTON_SIZE.COMPACT}
                icon={<EllipsisIcon />}
                label={COMMENT_WORDS.MORE}
                {...trigger}
              />
            </Tooltip>
            {menu.drawn === undefined ? null : (
              <ActionMenu
                label={COMMENT_WORDS.MORE}
                menu={menu.drawn}
                groups={[items]}
                onClose={menu.close}
              />
            )}
          </div>
          <ConfirmDialog
            confirm={deleting}
            question={first ? DELETE_THREAD_QUESTION : DELETE_QUESTION}
          />
        </span>
      </div>
      {lead}
      {editing === undefined ? (
        <CommentWords words={entry.words ?? ""} />
      ) : (
        <div className="comment-field comment-editing">
          <CommentText
            value={editing}
            label={COMMENT_WORDS.EDIT}
            onChange={setEditing}
            onSubmit={save}
            onCancel={() => setEditing(undefined)}
            autoFocus
          />
          <div className="comment-field-foot">
            <Button onClick={() => setEditing(undefined)}>{COMMENT_WORDS.CANCEL}</Button>
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={save}>
              {COMMENT_WORDS.SAVE}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A comment's words as Markdown, its mentions drawn as their chips, as a message's are. */
function CommentWords({ words }: { words: string }): React.JSX.Element {
  const link = useMentionLink();
  const openLink = useOpenLink();
  return (
    <MarkdownMessage
      words={words}
      className="comment-words markdown"
      link={link}
      openLink={openLink}
    />
  );
}

/** A comment's field: the agent box's editor, where its bundle has loaded and the page offers mentions, with `@` picking them; a plain field otherwise. Return posts, Shift-Return breaks the line, Escape cancels. */
function CommentText(props: CommentTextProps): React.JSX.Element {
  const field = useCommentEditor();
  // Note that a bundle that never loads leaves the plain field, so a comment can always be written.
  if (field === undefined) return <PlainCommentText {...props} />;
  return <MentionCommentText {...props} module={field.module} mentions={field.mentions} />;
}

/** The agent box's editor a comment is written in, where the page offers mentions and the bundle has not failed; nothing where the plain field stands in. */
function useCommentEditor():
  | { readonly module: PlanEditorModule | undefined; readonly mentions: TaskMentionsValue }
  | undefined {
  const bundle = useAtomValue(useSideBundles().planEditor);
  const mentions = useTaskMentions();
  if (AsyncResult.isFailure(bundle) || mentions === undefined) return undefined;
  return { module: AsyncResult.isSuccess(bundle) ? bundle.value : undefined, mentions };
}

interface CommentTextProps {
  readonly value: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly autoFocus?: boolean;
  /** Where the editor's handle is kept, for a dictation laid into it; the field keeps its own where none is handed. */
  readonly editor?: RefObject<ComposerEditorHandle | undefined> | undefined;
  /** The dictation the field's words come from while it records, which takes its keys first and holds the words still. */
  readonly dictation?: DictationControl | undefined;
}

/** The comment's field on the agent box's editor: mentions as chips, written as their links. */
function MentionCommentText({
  value,
  label,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
  module,
  mentions,
  editor: handed,
  dictation,
}: CommentTextProps & {
  module: PlanEditorModule | undefined;
  mentions: TaskMentionsValue;
}): React.JSX.Element {
  const own = useRef<ComposerEditorHandle | undefined>(undefined);
  const editor = handed ?? own;
  const dictating = dictation !== undefined && dictation.phase !== DICTATION_PHASE.IDLE;
  const room = useRef<HTMLDivElement>(null);
  const known = useKnownNames();
  const picker = useMentionPicker({
    source: mentions,
    room,
    // Note that the list rises over the card, since the cards under it in the margin would stand over it.
    side: MENTION_MENU_SIDE.ABOVE,
    onChoose: (mention) => editor.current?.chooseMention(mention),
    // Luke is offered with the agents, whom a comment's mention sends its thread.
    luke: true,
  });
  return (
    <ComposerField
      module={module}
      editor={editor}
      room={room}
      draft={value}
      setDraft={onChange}
      placeholder={label}
      label={label}
      input={dictating ? COMPOSER_INPUT.READ_ONLY : COMPOSER_INPUT.EDITABLE}
      maxLength={PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS}
      skills={NO_SKILLS}
      aria={{ "aria-placeholder": label }}
      onKey={(event) => {
        if (dictation?.onFieldKey(event) === true || picker.onKey(event)) return true;
        if (event.key !== "Escape") return false;
        event.preventDefault();
        onCancel();
        return true;
      }}
      onEnter={onSubmit}
      onPasteFiles={() => false}
      onTrigger={() => undefined}
      chip={() => null}
      mentions={{
        onTrigger: picker.onTrigger,
        chip: (mention) => <MentionNodeChip mention={mention} doors={mentions.doors} />,
        pasted: (words) =>
          pastedMentionNode(words, mentions.doors.place, {
            known,
            taskId: mentions.taskId,
            text: mentions.text,
          }),
      }}
      focus={autoFocus}
    >
      {picker.menu}
    </ComposerField>
  );
}

/** A comment takes no skills, which are an agent's. */
const NO_SKILLS: ReadonlySet<string> = new Set();

/**
 * A comment's words as they are typed: Return sends, Shift-Return breaks the
 * line, and Esc lets the field go. A plain field, so the field's own undo
 * and redo change its words and never the plan's.
 */
function PlainCommentText({
  value,
  label,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
}: CommentTextProps): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={field}
      className="comment-text"
      rows={1}
      value={value}
      placeholder={label}
      aria-label={label}
      // biome-ignore lint/a11y/noAutofocus: the field is opened by the press that asked for it, as a reply field is.
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/** The field under a thread that answers it, or starts it where it is the thread being started. */
function ReplyField({
  label,
  sending,
  onSend,
  onCancel,
  autoFocus,
  variant = REPLY_VARIANT.REPLY,
}: {
  label: string;
  sending: boolean;
  /** Sends the words under a key that stays the same while they do, so a send tried again after a lost answer is taken once. */
  onSend: (words: string, clientKey: string) => Promise<boolean>;
  onCancel: () => void;
  autoFocus: boolean;
  /** A thread's first comment, which is the card itself, or a reply under its comments, which stays a line until it is used. */
  variant?: ReplyVariant;
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const [heard, setHeard] = useState<string | undefined>(undefined);
  const dictation = useDictation({ editor, keywords: NO_KEYWORDS, onNote: setHeard });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  // Note that only the agent box's editor takes a dictation, so the plain field offers none.
  const dictates = useCommentEditor() !== undefined;
  const [words, setWords] = useState("");
  // The words sent and not yet answered, which the field holds as a draft while it stands empty, so a send that fails finds them.
  const [inFlight, setInFlight] = useState("");
  const attempt = useRef<{ words: string; key: string } | undefined>(undefined);
  const send = () => {
    const trimmed = words.trim();
    if (trimmed === "" || sending) return;
    const key = attempt.current?.words === trimmed ? attempt.current.key : crypto.randomUUID();
    attempt.current = { words: trimmed, key };
    // Note that the field empties as the words are sent, since a send may wait on the ones its mentions hand the thread to, and takes them back where the send fails and nothing was typed since.
    setWords("");
    setInFlight(trimmed);
    void onSend(trimmed, key).then((sent) => {
      setInFlight("");
      if (sent) {
        attempt.current = undefined;
        return;
      }
      setWords((now) => (now === "" ? trimmed : now));
    });
  };
  return (
    <div
      className="comment-field"
      data-variant={variant}
      // Note that the words in flight, and a dictation whose words land once heard, hold the field as typed words do, so a press away keeps a thread being started.
      data-held={(words === "" ? inFlight : words).trim() !== "" || dictating}
    >
      <CommentText
        value={words}
        label={label}
        onChange={setWords}
        onSubmit={send}
        onCancel={onCancel}
        autoFocus={autoFocus}
        editor={editor}
        dictation={dictation}
      />
      {heard === undefined ? null : (
        <div className="comment-note" role="alert">
          {heard}
        </div>
      )}
      <div className="comment-field-foot">
        {dictating ? (
          <DictationStrip dictation={dictation} />
        ) : (
          <span className="comment-field-tools">
            {dictates ? <DictateButton dictation={dictation} disabled={sending} /> : null}
            <IconButton
              submit={sending ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.READY}
              variant={BUTTON_VARIANT.INK}
              label={label === COMMENT_WORDS.ADD ? COMMENT_WORDS.COMMENT : COMMENT_WORDS.REPLY}
              disabled={words.trim() === "" || sending}
              onClick={send}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** How a comment's field stands: as a thread's first comment, the card itself, or as a reply under its comments. */
const REPLY_VARIANT = { FIRST: "first", REPLY: "reply" } as const;

type ReplyVariant = (typeof REPLY_VARIANT)[keyof typeof REPLY_VARIANT];

/** A comment's dictation hears no names of its own, which an agent's box takes from its repository. */
const NO_KEYWORDS: readonly string[] = [];

/** Over a thread whose words were deleted: that they were, and what they said. */
function GoneQuote({
  thread,
  onShowWords,
}: {
  thread: PlanCommentThread;
  /** Shows where the words stood, their section's start; none where the quote is only words. */
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <div className="comment-gone">
        <TrashIcon />
        {COMMENT_WORDS.GONE}
      </div>
      <ThreadQuote thread={thread} gone onShowWords={onShowWords} />
    </>
  );
}

/** A thread's quote over it: its words, or a press that shows them in the plan where it is offered. */
function ThreadQuote({
  thread,
  gone = false,
  onShowWords,
}: {
  thread: PlanCommentThread;
  gone?: boolean;
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  if (onShowWords === undefined) {
    return (
      <blockquote className="comment-quote" data-gone={gone}>
        {thread.quote}
      </blockquote>
    );
  }
  return (
    <Tooltip label={COMMENT_WORDS.SHOW_WORDS}>
      <button
        type="button"
        className="comment-quote comment-quote-link"
        data-gone={gone}
        onClick={onShowWords}
      >
        {thread.quote}
      </button>
    </Tooltip>
  );
}

/**
 * One thread as the margin, a count's card, or the Comments tab draws it:
 * open, every entry and the field that answers it; at rest, its first
 * comment and the faces and count of its replies, which opens it.
 */
function ThreadCard({
  thread,
  open,
  doors,
  onOpen,
  onClose,
  quote = false,
  pointed = false,
  onShowWords,
}: {
  thread: PlanCommentThread;
  open: boolean;
  doors: ThreadDoors;
  /** Opens the card at rest; none where it always stands open, as in the Comments tab. */
  onOpen?: (() => void) | undefined;
  /** Closes it, as its field's Escape asks. */
  onClose?: (() => void) | undefined;
  /** Whether the quote stands over it, as in the Comments tab, where its words are not beside it. */
  quote?: boolean;
  /** Whether the pointer is on the thread's words, which the card at rest answers as it answers the pointer itself. */
  pointed?: boolean;
  /** Shows the thread's words where the plan holds them, which its quote offers; none where the quote is only words. */
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const [sending, setSending] = useState(false);
  const comments = thread.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT);
  const [first] = comments;
  const gone = thread.anchor === undefined;
  const note = doors.control.notes.get(thread.id);
  const head = (
    <>
      {gone ? <GoneQuote thread={thread} onShowWords={onShowWords} /> : null}
      {!gone && quote ? <ThreadQuote thread={thread} onShowWords={onShowWords} /> : null}
    </>
  );
  if (!open) {
    const replies = comments.slice(1);
    const faces = [
      ...new Map(replies.map((entry) => [JSON.stringify(entry.writer), entry.writer])).values(),
    ];
    // Note that the whole card at rest is one press that opens it, but for what is a press of its own inside it, a writer's name say; its button is the keyboard's way in.
    const pressed = (event: React.MouseEvent<HTMLDivElement>) => {
      const inner =
        event.target instanceof Element
          ? event.target.closest("a, button, [role='button'], [role='menuitem']")
          : null;
      if (inner === null || inner.classList.contains("comment-open")) onOpen?.();
    };
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: the card's own button takes the keyboard, and this widens its press to the card
      // biome-ignore lint/a11y/useKeyWithClickEvents: the card's own button takes the keyboard, and this widens its press to the card
      <div
        className="comment-card"
        data-open="false"
        data-pointed={pointed}
        data-thread={thread.id}
        onClick={pressed}
        // Note that a mention's chip takes its own press and lets it go no further, so the card hears it first and opens with it.
        onClickCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("[data-mention-ref]") !== null
          ) {
            onOpen?.();
          }
        }}
      >
        {head}
        {first === undefined ? null : (
          <div className="comment-head">
            <WriterRef writer={first.writer} agents={doors.agents} />
            <span className="comment-time">
              <RelativeTime at={first.at} now={now} ago />
            </span>
          </div>
        )}
        {/* Note that the words are drawn as they are open, their chips with them, clamped; the card's press opens the thread. */}
        {first === undefined ? null : (
          <div className="comment-clamp">
            <CommentWords words={first.words ?? ""} />
          </div>
        )}
        {/* Note that the card's button is the keyboard's way in, the replies drawn on it, or its name alone where there are none. */}
        <button type="button" className="comment-open">
          {replies.length === 0 ? (
            <span className="luke-visually-hidden">{COMMENT_WORDS.OPEN_THREAD}</span>
          ) : (
            <span className="comment-replies">
              <span className="comment-faces">
                {faces.map((writer) => (
                  <WriterMark key={JSON.stringify(writer)} writer={writer} agents={doors.agents} />
                ))}
              </span>
              {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
              <span className="comment-time">
                {" · "}
                <RelativeTime at={replies.at(-1)?.at ?? thread.updatedAt} now={now} ago />
              </span>
            </span>
          )}
        </button>
      </div>
    );
  }
  return (
    <div className="comment-card" data-open="true" data-thread={thread.id}>
      {first === undefined ? head : null}
      {thread.entries.map((entry) =>
        entry.kind === PLAN_COMMENT_ENTRY.COMMENT ? (
          <CommentEntry
            key={entry.id}
            thread={thread}
            entry={entry}
            first={entry.id === first?.id}
            doors={doors}
            now={now}
            lead={entry.id === first?.id ? head : undefined}
          />
        ) : // Note that who a thread was sent to is the mention in its words, so the line an ask writes is the service's to keep and none to draw.
        entry.kind === PLAN_COMMENT_ENTRY.ASKED ? null : (
          <EventLine key={entry.id} entry={entry} agents={doors.agents} now={now} />
        ),
      )}
      {note === undefined ? null : (
        <div className="comment-note" role="alert">
          {note}
        </div>
      )}
      {thread.status === PLAN_COMMENT_STATUS.OPEN ? (
        <ReplyField
          label={COMMENT_WORDS.REPLY}
          sending={sending}
          autoFocus={false}
          onCancel={() => onClose?.()}
          onSend={async (words, clientKey) => {
            setSending(true);
            const sent = await doors.control.act(thread.id, {
              action: PLAN_COMMENT_ACTION.REPLY,
              clientKey,
              words,
            });
            setSending(false);
            return sent;
          }}
        />
      ) : null}
    </div>
  );
}

/** The thread being started, its field focused, which posts its first comment. */
function PendingCard({
  pending,
  doors,
  text,
  onStarted,
  onCancel,
}: {
  pending: PendingThread;
  doors: ThreadDoors;
  /** The plan's text the thread's words are measured in. */
  text: string;
  onStarted: (thread: PlanCommentThread) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  return (
    <div className="comment-card" data-open="true" data-thread={PENDING_THREAD}>
      {note === undefined ? null : (
        <div className="comment-note" role="alert">
          {note}
        </div>
      )}
      <ReplyField
        label={COMMENT_WORDS.ADD}
        sending={sending}
        autoFocus
        onCancel={onCancel}
        variant={REPLY_VARIANT.FIRST}
        onSend={async (words, clientKey) => {
          setSending(true);
          const started = await doors.control.start({
            clientKey,
            scope: pending.scope,
            quote: pending.quote,
            anchor: { from: pending.from, to: pending.to },
            // Note that words started on in the editor are measured in its text, which the service lays over the saved one.
            text: pending.text ?? text,
            words,
          });
          setSending(false);
          if ("note" in started) {
            setNote(started.note);
            return false;
          }
          onStarted(started.thread);
          return true;
        }}
      />
    </div>
  );
}

/** Where words drawn inside `root` stand in its drawn text, from its start to the point. */
function drawnOffset(root: HTMLElement, node: globalThis.Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A block's own words in its section's drawn text: a bullet's up to the list nested under it, which its own bullets are commented on apart; any other block's whole. */
function ownWords(unit: HTMLElement, block: HTMLElement) {
  const from = drawnOffset(unit, block, 0);
  const quote = ownRange(block).toString().trimEnd();
  return { quote, from, to: from + quote.length };
}

/** A block's own words, a list item's without the bullets nested under it. */
function ownRange(block: HTMLElement): Range {
  const nested = [...block.childNodes].findIndex(
    (child) => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL"),
  );
  const range = document.createRange();
  range.selectNodeContents(block);
  if (nested >= 0) range.setEnd(block, nested);
  return range;
}

/**
 * Whether threads' marks cover every one of the block's own words, as a
 * thread on the block does, so it is commented on through them; a thread on
 * a few of its words, or on a bullet nested under it, leaves it its button.
 */
function threadedWhole(block: HTMLElement): boolean {
  const own = ownRange(block);
  const marked = [...block.querySelectorAll(`.${COMMENT_MARK_CLASS}[data-threads]`)]
    .filter(
      (mark) =>
        own.intersectsNode(mark) && mark.parentElement?.closest(`.${COMMENT_MARK_CLASS}`) === null,
    )
    .map((mark) => mark.textContent ?? "")
    .join("");
  const words = own.toString().replace(/\s+/gu, "");
  return words !== "" && marked.replace(/\s+/gu, "") === words;
}

/** A thread started on the editor's words, its quote held to the bound the service keeps. */
function editorPending(span: EditorSpan, scope: PlanCommentThread["scope"]): PendingThread {
  return { ...span, scope, quote: span.quote.slice(0, PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

/** The words a section's drawn stretch stands for in the plan's text, laid over the section's source; nothing where none of them do. */
function sourceSpan(
  unit: HTMLElement,
  section: PlanSection,
  drawn: { readonly from: number; readonly to: number },
): { readonly from: number; readonly to: number } | undefined {
  const span = textChange(unit.textContent ?? "", section.text)(drawn);
  return span === undefined
    ? undefined
    : { from: section.from + span.from, to: section.from + span.to };
}

/** What a thread is started on: the words or block drawn, as the plan's text holds them. */
function pendingOf(
  unit: HTMLElement,
  section: PlanSection,
  drawn: { readonly from: number; readonly to: number },
  scope: PendingThread["scope"],
  quote: string,
): PendingThread | undefined {
  const span = sourceSpan(unit, section, drawn);
  return span === undefined
    ? undefined
    : { ...span, scope, quote: quote.slice(0, PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

/** Where an element's top stands in the plan body's own box. */
function topIn(body: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - body.getBoundingClientRect().top;
}

/** The block a point is over, one of a section's own: a paragraph, a list, a heading, a quote, a table, or code. */
function blockAt(
  target: EventTarget | null,
  unitClass: string,
): { block: HTMLElement; unit: HTMLElement } | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const unit = target.closest<HTMLElement>(`.${unitClass}`);
  if (unit === null) return undefined;
  // A list is commented on a bullet at a time, its innermost one under the pointer, and the gaps between them offer none.
  if (target.tagName === "UL" || target.tagName === "OL") return undefined;
  const item = target.closest<HTMLElement>("li");
  if (item !== null && unit.contains(item)) return { block: item, unit };
  let block: HTMLElement | null = target;
  while (block !== null && block.parentElement !== unit) block = block.parentElement;
  return block === null ? undefined : { block, unit };
}

/**
 * The plan's comments beside its body: the margin or the counts, the
 * thread being started, the button a block shows under the pointer, and
 * the bubble over words selected. Drawn inside the body, which it measures,
 * from the scroller around it, whose width says whether a margin fits.
 */
/** The sheet naming the open thread's words in the editor, built once; a constructed sheet, since the window's policy takes no inline style. */
let openThreadSheet: CSSStyleSheet | undefined;

/** The open thread's words drawn open in the editor, as the read view draws its marks with `data-active`; none where no thread is open. */
function editorOpenThread(thread: string | undefined): void {
  if (!("CSSStyleSheet" in globalThis) || !("adoptedStyleSheets" in document)) return;
  if (openThreadSheet === undefined) {
    openThreadSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, openThreadSheet];
  }
  // Note that a thread's id is the service's UUID, which a selector takes as it is; the rule draws the edge whole, so words inside another thread's mark, which draws none of its own, show it too.
  openThreadSheet.replaceSync(
    thread === undefined
      ? ""
      : `.plan-document-text .${COMMENT_MARK_CLASS}[data-threads~="${thread}"] { padding-bottom: 1px; border-bottom: 1.5px solid var(--comment-mark-active-edge); background: var(--comment-mark-active); }`,
  );
}

/** The thread itself and what it opened over the page, where a caret or the focus is the thread's rather than the words'. */
const THREAD_ITSELF = '.comment-card, [role="menu"], [role="dialog"], [role="alertdialog"]';

/** What a press may land on and leave the open thread open: its card, a thread's words or count, the controls that start one, and a menu or dialog it opened. */
const KEEPS_THREAD_OPEN = [
  ".comment-card",
  `.${COMMENT_MARK_CLASS}`,
  ".comment-count",
  ".comment-bubble",
  ".comment-block-button",
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(", ");

export function PlanCommentLayer({
  body,
  scroller,
  unitClass,
  sections,
  text,
  doors,
  editor,
}: {
  body: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  /** The class each section's drawn words wear, in the order of `sections`. */
  unitClass: string;
  sections: readonly PlanSection[];
  /** The plan's text, which `sections` were read from and a thread's words are measured in. */
  text: string;
  doors: ThreadDoors;
  /**
   * The open editor's handle, where the editor stands in place of the drawn
   * sections: a thread started there is measured on the editor's words, in
   * the text it would hand over now, rather than on a section's.
   */
  editor: RefObject<PlanEditorHandle | undefined> | undefined;
}): React.JSX.Element | null {
  const { active, onActive, pending, revealed } = useCommentFocus();
  const setPending = useContext(PendingSetter);
  const [wide, setWide] = useState(true);
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  // Where each thread's words stand, which a fold's counts stand level with.
  const [anchors, setAnchors] = useState<ReadonlyMap<string, number>>(new Map());
  const [hovered, setHovered] = useState<{ top: number; start: () => void } | undefined>(undefined);
  // The thread whose words the pointer is on, whose card answers it before a press.
  const [pointed, setPointed] = useState<string | undefined>(undefined);
  // Whether the open thread was opened by the editor's caret standing in its words, which closes it as the caret leaves them.
  const caretOpened = useRef(false);
  const [bubble, setBubble] = useState<
    { top: number; left: number; start: () => void } | undefined
  >(undefined);
  const cards = useRef(new Map<string, HTMLDivElement>());
  // The cards already stood in the margin, which move to their next place rather than land there, so a card arriving lands where it belongs.
  const settled = useRef(new Set<string>());
  const open = doors.control.threads.filter(openThread);

  // The margin folds where the scroller has no room for it beside the reading width.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => setWide(element.clientWidth >= READING_WIDTH + MARGIN_ROOM + PAGE_INSETS);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    element.dataset.comments =
      wide && (open.length > 0 || pending !== undefined) ? "margin" : "folded";
  });

  // Each card's words are measured after the body draws them, and the cards stood beside them.
  const anchorTop = useCallback(
    (thread: string, section: string): number | undefined => {
      const element = body.current;
      if (element === null) return undefined;
      const mark = element.querySelector(`.${COMMENT_MARK_CLASS}[data-threads~="${thread}"]`);
      if (mark !== null) return topIn(element, mark);
      // Note that a thread's id is the service's UUID, which a selector takes as it is.
      // A thread whose words were deleted stands where its section starts, or at the top.
      const at = sections.findIndex((each) => each.heading === section);
      const unit = at < 0 ? undefined : element.querySelectorAll(`.${unitClass}`)[at];
      return unit === undefined ? 0 : topIn(element, unit);
    },
    [body, sections, unitClass],
  );
  useLayoutEffect(() => {
    const placed = [
      ...open.map((thread) => ({ id: thread.id, section: thread.section })),
      ...(pending === undefined ? [] : [{ id: PENDING_THREAD, section: "" }]),
    ].flatMap(({ id, section }) => {
      const top = anchorTop(id, section);
      return top === undefined
        ? []
        : [{ id, top, height: cards.current.get(id)?.offsetHeight ?? 0 }];
    });
    const next = marginTops(
      placed,
      active ?? (pending === undefined ? undefined : PENDING_THREAD),
      CARD_GAP,
    );
    const same = next.size === tops.size && [...next].every(([id, top]) => tops.get(id) === top);
    if (!same) setTops(next);
    const nextAnchors = new Map(placed.map((card) => [card.id, card.top]));
    const sameAnchors =
      nextAnchors.size === anchors.size &&
      [...nextAnchors].every(([id, top]) => anchors.get(id) === top);
    if (!sameAnchors) setAnchors(nextAnchors);
  });

  // An ask to show a thread scrolls the document's own scroller to its words, once per ask.
  const scrolled = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scroller.current;
    const room = body.current;
    if (revealed === undefined || element === null || room === null) return;
    if (scrolled.current === revealed.ask) return;
    // Note that the ask waits for the read to name the thread, since a link may open the plan before its comments land.
    const asked = doors.control.threads.find((each) => each.id === revealed.thread);
    if (!doors.control.read || asked === undefined) return;
    const top = anchorTop(asked.id, asked.section);
    if (top === undefined) return;
    scrolled.current = revealed.ask;
    element.scrollTop +=
      room.getBoundingClientRect().top + top - element.getBoundingClientRect().top - REVEAL_ROOM;
  });

  // A block under the pointer shows its button at the column's end; words selected raise the bubble over them.
  useEffect(() => {
    const element = body.current;
    if (element === null) return;
    const over = (event: PointerEvent) => {
      const marked =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`)
          : null;
      setPointed(marked?.dataset.threads?.split(" ")[0]);
      const found = blockAt(event.target, unitClass);
      if (found === undefined) return;
      // Note that a block whose words a thread already covers is commented on through that thread, so it offers no button.
      if (threadedWhole(found.block)) {
        setHovered(undefined);
        return;
      }
      if (editor !== undefined) {
        setHovered({
          top: topIn(element, found.block),
          start: () => {
            const span = editor.current?.blockSpan(found.block);
            if (span !== undefined) setPending(editorPending(span, PLAN_COMMENT_SCOPE.BLOCK));
          },
        });
        return;
      }
      const index = [...element.querySelectorAll(`.${unitClass}`)].indexOf(found.unit);
      const section = sections[index];
      if (section === undefined) return;
      const { quote, from, to } = ownWords(found.unit, found.block);
      setHovered({
        top: topIn(element, found.block),
        start: () => {
          const begun = pendingOf(
            found.unit,
            section,
            { from, to },
            PLAN_COMMENT_SCOPE.BLOCK,
            quote,
          );
          if (begun !== undefined) setPending(begun);
        },
      });
    };
    // In the editor, a caret standing in a thread's words opens it, and leaving them closes the one it opened.
    const letCaretGo = () => {
      if (!caretOpened.current) return;
      caretOpened.current = false;
      onActive(undefined);
    };
    const caretIn = (selection: Selection) => {
      if (active === PENDING_THREAD) return;
      const node = selection.anchorNode;
      const at = node instanceof Element ? node : node?.parentElement;
      if (at === null || at === undefined) return;
      // Note that a caret in the thread itself, its reply say, takes it over, so it no longer closes as the caret leaves its words.
      if (at.closest(THREAD_ITSELF) !== null) {
        caretOpened.current = false;
        return;
      }
      if (!element.contains(at)) {
        letCaretGo();
        return;
      }
      const threads = (
        at.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`)?.dataset.threads ?? ""
      )
        .split(" ")
        .filter((thread) => thread !== "" && thread !== PENDING_THREAD);
      if (threads.length > 0) {
        if (active !== undefined && threads.includes(active)) return;
        caretOpened.current = true;
        onActive(threads[0]);
        return;
      }
      letCaretGo();
    };
    // The editor let go of by the keyboard, Tab say, lets go of the thread its caret opened, but for the thread itself taking the focus.
    const blurred = (event: FocusEvent) => {
      if (editor === undefined) return;
      const next = event.relatedTarget;
      // Note that a press on words that take no focus, a card's say, lets the focus go to nothing, and the press's own rule says whether it closes the thread.
      if (next === null) return;
      if (
        next instanceof Element &&
        (element.contains(next) || next.closest(THREAD_ITSELF) !== null)
      ) {
        if (next.closest(THREAD_ITSELF) !== null) caretOpened.current = false;
        return;
      }
      letCaretGo();
    };
    const selected = () => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        if (editor !== undefined && selection?.isCollapsed === true) caretIn(selection);
        setBubble(undefined);
        return;
      }
      const range = selection.getRangeAt(0);
      const start = range.startContainer.parentElement?.closest<HTMLElement>(`.${unitClass}`);
      const end = range.endContainer.parentElement?.closest<HTMLElement>(`.${unitClass}`);
      if (start === null || start === undefined || start !== end || !element.contains(start)) {
        setBubble(undefined);
        return;
      }
      const box = range.getBoundingClientRect();
      const own = element.getBoundingClientRect();
      // In the editor the words are measured through it, and its selection is left as it stands.
      if (editor !== undefined) {
        setBubble({
          top: box.top - own.top,
          left: box.left - own.left,
          start: () => {
            const span = editor.current?.selectionSpan();
            if (span !== undefined) setPending(editorPending(span, PLAN_COMMENT_SCOPE.WORDS));
            setBubble(undefined);
          },
        });
        return;
      }
      const index = [...element.querySelectorAll(`.${unitClass}`)].indexOf(start);
      const section = sections[index];
      const quote = selection.toString().trim();
      if (section === undefined || quote === "") return;
      const from = drawnOffset(start, range.startContainer, range.startOffset);
      const to = drawnOffset(start, range.endContainer, range.endOffset);
      setBubble({
        top: box.top - own.top,
        left: box.left - own.left,
        start: () => {
          const begun = pendingOf(start, section, { from, to }, PLAN_COMMENT_SCOPE.WORDS, quote);
          if (begun !== undefined) setPending(begun);
          setBubble(undefined);
          selection.removeAllRanges();
        },
      });
    };
    // Note that a press on marked words opens their thread, as the editor would otherwise open there.
    const pressed = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const mark = event.target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`);
      // Note that words under more than one thread open the next of them each press.
      const threads = (mark?.dataset.threads ?? "")
        .split(" ")
        .filter((each) => each !== "" && each !== PENDING_THREAD);
      const thread = threads[(threads.indexOf(active ?? "") + 1) % Math.max(threads.length, 1)];
      if (thread === undefined) return;
      setPending(undefined);
      onActive(thread);
    };
    const left = () => setPointed(undefined);
    element.addEventListener("pointerover", over);
    element.addEventListener("pointerleave", left);
    element.addEventListener("focusout", blurred);
    // Note that in the editor a press places the caret, so marked words there open no thread.
    if (editor === undefined) element.addEventListener("click", pressed);
    document.addEventListener("selectionchange", selected);
    return () => {
      element.removeEventListener("pointerover", over);
      element.removeEventListener("pointerleave", left);
      element.removeEventListener("focusout", blurred);
      element.removeEventListener("click", pressed);
      document.removeEventListener("selectionchange", selected);
    };
  }, [body, editor, sections, unitClass, setPending, onActive, active]);

  const cardRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element === null) cards.current.delete(id);
    else cards.current.set(id, element);
  };
  useEffect(() => {
    settled.current = new Set(tops.keys());
  });
  // The editor's marks are the editor's own, so the open thread's words are drawn open there by a rule naming them.
  const editorActive = editor !== undefined && active !== PENDING_THREAD ? active : undefined;
  useEffect(() => {
    editorOpenThread(editorActive);
    return () => editorOpenThread(undefined);
  }, [editorActive]);
  // A press anywhere but the thread, its words, or what it opened over the page closes it; a thread being started goes too while empty, and stays holding a draft, as a box's draft does.
  useEffect(() => {
    if (active === undefined) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(KEEPS_THREAD_OPEN) !== null) {
        return;
      }
      if (active === PENDING_THREAD) {
        if (cards.current.get(PENDING_THREAD)?.querySelector('[data-held="true"]')) return;
        setPending(undefined);
      }
      onActive(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active, onActive, setPending]);
  const slotStyle = (id: string) => ({ transform: `translateY(${tops.get(id) ?? 0}px)` });
  const close = () => {
    onActive(undefined);
    setPending(undefined);
  };
  const pendingCard =
    pending === undefined ? null : (
      <PendingCard
        pending={pending}
        doors={doors}
        text={text}
        onCancel={close}
        onStarted={(thread) => {
          setPending(undefined);
          onActive(thread.id);
        }}
      />
    );
  const blockButton =
    // Note that folded, a line holding a count opens its threads there, a thread whose words were deleted counted at its section's top too, so its block shows no button over it.
    hovered === undefined ||
    (!wide && [...anchors.values()].some((top) => Math.abs(top - hovered.top) < 4)) ? null : (
      <div className="comment-block-button" style={{ top: hovered.top }}>
        <Tooltip label={COMMENT_WORDS.COMMENT}>
          {/* Note that the press takes no focus, so an open editor stays to measure the block through. */}
          <IconButton
            keepFocus
            icon={<MessageSquarePlusIcon />}
            label={COMMENT_WORDS.COMMENT}
            onClick={hovered.start}
          />
        </Tooltip>
      </div>
    );
  const bubbleDrawn =
    bubble === undefined ? null : (
      <div className="comment-bubble menu-surface" style={{ top: bubble.top, left: bubble.left }}>
        <Button keepFocus icon={<MessageSquarePlusIcon />} onClick={bubble.start}>
          {COMMENT_WORDS.COMMENT}
        </Button>
      </div>
    );
  if (wide) {
    return (
      <div className="comment-layer">
        {blockButton}
        {bubbleDrawn}
        <div className="comment-margin">
          {open.map((thread) => (
            <div
              key={thread.id}
              ref={cardRef(thread.id)}
              className="comment-slot"
              data-moves={settled.current.has(thread.id)}
              style={slotStyle(thread.id)}
            >
              <ThreadCard
                thread={thread}
                open={active === thread.id}
                doors={doors}
                pointed={pointed === thread.id}
                onOpen={() => {
                  setPending(undefined);
                  onActive(thread.id);
                }}
                onClose={close}
              />
            </div>
          ))}
          {pendingCard === null ? null : (
            <div
              ref={cardRef(PENDING_THREAD)}
              className="comment-slot"
              data-moves={settled.current.has(PENDING_THREAD)}
              style={slotStyle(PENDING_THREAD)}
            >
              {pendingCard}
            </div>
          )}
        </div>
      </div>
    );
  }
  // Folded: a count at the end of each line holding marks, the open thread floating under it.
  const counts = new Map<number, PlanCommentThread[]>();
  for (const thread of open) {
    const top = anchors.get(thread.id);
    if (top === undefined) continue;
    counts.set(top, [...(counts.get(top) ?? []), thread]);
  }
  const shown = open.find((thread) => thread.id === active);
  const shownTop = shown === undefined ? undefined : anchors.get(shown.id);
  return (
    <div className="comment-layer">
      {blockButton}
      {bubbleDrawn}
      {[...counts].map(([top, threads]) => {
        const comments = threads.reduce(
          (sum, thread) =>
            sum +
            thread.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT).length,
          0,
        );
        const first = threads[0];
        return (
          <span key={top} className="comment-count" style={{ top }}>
            <Button
              icon={<MessageSquareIcon />}
              label={`${comments} ${comments === 1 ? "comment" : "comments"}`}
              aria-expanded={threads.some((thread) => thread.id === active)}
              onClick={() =>
                onActive(threads.some((thread) => thread.id === active) ? undefined : first?.id)
              }
            >
              {comments}
            </Button>
          </span>
        );
      })}
      {shown === undefined || shownTop === undefined ? null : (
        // Every thread on the line stands under its count, the one pressed open, so none is hidden behind another.
        <div className="comment-float" style={{ top: shownTop + 28 }}>
          {(counts.get(shownTop) ?? [shown]).map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              open={thread.id === active}
              doors={doors}
              onOpen={() => onActive(thread.id)}
              onClose={close}
            />
          ))}
        </div>
      )}
      {pendingCard === null ? null : (
        <div
          className="comment-float"
          style={{ top: (anchors.get(PENDING_THREAD) ?? 0) + 28 }}
          ref={cardRef(PENDING_THREAD)}
        >
          {pendingCard}
        </div>
      )}
    </div>
  );
}

const PendingSetter = createContext<(pending: PendingThread | undefined) => void>(() => undefined);

/** Holds which thread is open and the one being started, for the marks, the margin, and the Comments tab under it. */
export function CommentFocusScope({
  planId,
  children,
  reveal,
}: {
  /** The plan the focus is on; another plan opened lets go of the open thread and the one being started. */
  planId?: string | undefined;
  children: ReactNode;
  /** A thread to open, as a link to it asks; opened once per ask. */
  reveal?: { readonly thread: string; readonly ask: number } | undefined;
}): React.JSX.Element {
  const [active, setActive] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingThread | undefined>(undefined);
  const [revealed, setRevealed] = useState<CommentFocus["revealed"]>(undefined);
  const [focusedOn, setFocusedOn] = useState(planId);
  // Note that the thread being started is let go in the render the plan changes in, so it is never posted to another plan.
  if (focusedOn !== planId) {
    setFocusedOn(planId);
    setActive(undefined);
    setPending(undefined);
    setRevealed(undefined);
  }
  const asked = useRef<number | undefined>(undefined);
  const onReveal = useCallback((thread: string) => {
    setPending(undefined);
    setActive(thread);
    setRevealed((was) => ({ thread, ask: (was?.ask ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (reveal === undefined || asked.current === reveal.ask) return;
    asked.current = reveal.ask;
    onReveal(reveal.thread);
  }, [reveal, onReveal]);
  const focus = useMemo(
    () => ({
      active: focusedOn !== planId ? undefined : pending === undefined ? active : PENDING_THREAD,
      onActive: setActive,
      pending: focusedOn === planId ? pending : undefined,
      reveal: onReveal,
      revealed,
    }),
    [active, pending, onReveal, revealed, focusedOn, planId],
  );
  return (
    <CommentFocusContext.Provider value={focus}>
      <PendingSetter.Provider value={setPending}>{children}</PendingSetter.Provider>
    </CommentFocusContext.Provider>
  );
}

/** Which of the plan's threads the Comments tab lists. */
const COMMENTS_FILTER = { OPEN: "open", RESOLVED: "resolved" } as const;

type CommentsFilter = (typeof COMMENTS_FILTER)[keyof typeof COMMENTS_FILTER];

/** What the Comments tab's head names the threads it lists, by its filter. */
const COMMENTS_FILTER_WORDS = {
  [COMMENTS_FILTER.OPEN]: "Open",
  [COMMENTS_FILTER.RESOLVED]: "Resolved",
} as const satisfies Record<CommentsFilter, string>;

/** What the Comments tab's toggle says it does, by whether resolved threads are shown. */
const RESOLVED_PRESS = {
  SHOW: "Show resolved comments",
  HIDE: "Show open comments",
} as const;

/** The Comments tab's toggle, as the Inbox's Needs you is one: pressed, the tab lists the resolved threads in the open ones' place. */
function ResolvedOnly({
  shown,
  onShown,
}: {
  shown: boolean;
  onShown: (shown: boolean) => void;
}): React.JSX.Element {
  return (
    <Tooltip label={shown ? RESOLVED_PRESS.HIDE : RESOLVED_PRESS.SHOW}>
      <IconButton
        icon={<CircleCheckIcon />}
        label={COMMENTS_FILTER_WORDS[COMMENTS_FILTER.RESOLVED]}
        pressed={shown}
        onClick={() => onShown(!shown)}
      />
    </Tooltip>
  );
}

/** What the Comments tab says over a list holding nothing, by its filter. */
const NO_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: {
    title: "No comments",
    line: "Select words in the plan, or press a block's comment button, to start a thread.",
  },
  [COMMENTS_FILTER.RESOLVED]: {
    title: "No resolved comments",
    line: undefined,
  },
} as const satisfies Record<CommentsFilter, { title: string; line: string | undefined }>;

/**
 * The side panel's Comments tab: the plan's threads, open or resolved, each
 * under the section it is on and its quote. An open thread's press shows the
 * plan and opens it beside its words; a resolved one opens where it is
 * listed, with Reopen, which brings it back beside its words.
 */
export function PlanCommentsTab({
  doors,
  onShowDocument,
}: {
  doors: Omit<ThreadDoors, "control">;
  /** Shows the plan's own tab in the column, where an open thread is drawn. */
  onShowDocument: () => void;
}): React.JSX.Element | null {
  const control = usePlanCommentsControlOrUndefined();
  const { reveal, revealed } = useCommentFocus();
  const [filter, setFilter] = useState<CommentsFilter>(COMMENTS_FILTER.OPEN);
  // A resolved thread asked to be shown, as a link to it asks, is listed here under Resolved, the plan holding no card of it.
  const shownAsk = useRef<number | undefined>(undefined);
  const resolvedAsked =
    revealed === undefined
      ? undefined
      : control?.threads.find((thread) => thread.id === revealed.thread && !openThread(thread));
  useEffect(() => {
    if (revealed === undefined || resolvedAsked === undefined || shownAsk.current === revealed.ask)
      return;
    shownAsk.current = revealed.ask;
    setFilter(COMMENTS_FILTER.RESOLVED);
  }, [revealed, resolvedAsked]);
  // The thread a link opened here is scrolled to in the list, once per ask, the list alone moving.
  const list = useRef<HTMLDivElement>(null);
  const scrolledAsk = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = list.current;
    if (revealed === undefined || element === null || scrolledAsk.current === revealed.ask) return;
    if (shownAsk.current !== revealed.ask || filter !== COMMENTS_FILTER.RESOLVED) return;
    const row = element.querySelector(`.comment-card[data-thread="${revealed.thread}"]`);
    if (row === null) return;
    scrolledAsk.current = revealed.ask;
    element.scrollTop +=
      row.getBoundingClientRect().top - element.getBoundingClientRect().top - REVEAL_ROOM;
  });
  if (control === undefined) return null;
  const open = control.threads.filter(openThread);
  const resolved = control.threads.filter((thread) => !openThread(thread));
  const listed = filter === COMMENTS_FILTER.OPEN ? open : resolved;
  const full = { ...doors, control };
  return (
    <div className="comments-tab">
      <div className="comments-head">
        <span className="comments-head-title">
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {COMMENTS_FILTER_WORDS[filter]}
          </Text>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
            {listed.length}
          </Text>
        </span>
        <ResolvedOnly
          shown={filter === COMMENTS_FILTER.RESOLVED}
          onShown={(shown) => setFilter(shown ? COMMENTS_FILTER.RESOLVED : COMMENTS_FILTER.OPEN)}
        />
      </div>
      <div ref={list} className="comments-list scroll-fade">
        {control.failed ? (
          <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={control.onRetry}>
            The comments could not be read.
          </ErrorState>
        ) : listed.length === 0 ? (
          control.read ? (
            <EmptyState icon={<CommentsIcon />} title={NO_COMMENTS[filter].title}>
              {NO_COMMENTS[filter].line}
            </EmptyState>
          ) : null
        ) : (
          listed.map((thread) => (
            <div key={thread.id} className="comments-row">
              {/* Note that every thread stands whole here, its replies and its field, its quote the way to its words in the plan. */}
              <ThreadCard
                thread={thread}
                open
                quote
                doors={full}
                onShowWords={
                  openThread(thread)
                    ? () => {
                        onShowDocument();
                        reveal(thread.id);
                      }
                    : undefined
                }
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
