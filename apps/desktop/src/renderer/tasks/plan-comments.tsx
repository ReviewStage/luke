import { LINK_PLACE } from "@luke/features/luke-link";
import { agentTabLabel, modelLabel } from "@luke/features/model-label";
import { textChange } from "@luke/features/plan-comment-anchor";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentAsked,
  type PlanCommentEntry,
  type PlanCommentThread,
  type PlanCommentWriter,
} from "@luke/features/plan-comment-wire";
import type { PlanSection } from "@luke/features/plan-document";
import { ActorLine, ActorMark, ActorRef } from "@luke/panel/actor-ref";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { ActionMenu, type MenuAction } from "@luke/panel/desktop/action-menu";
import { usePerson } from "@luke/panel/member-directory";
import type { EditorSpan, PlanEditorHandle } from "@luke/panel/plan-editor/contract";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useMinute } from "@luke/panel/tasks/task-time";
import { Tooltip } from "@luke/panel/tooltip";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  EllipsisIcon,
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
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
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
  SEND_TO: "Send to",
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
  RESOLVED_BY: "Resolved by",
  REOPENED_BY: "Reopened by",
  ASKED: "asked",
  EDITED: "edited",
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

/** A line of what happened to a thread: who asked whom, who resolved or reopened it. */
function EventLine({
  entry,
  agents,
  now,
}: {
  entry: PlanCommentEntry;
  agents: EditAgents | undefined;
  now: number;
}): React.JSX.Element {
  const asked = entry.asked;
  return (
    <div className="comment-event">
      <ActorLine>
        {entry.kind === PLAN_COMMENT_ENTRY.ASKED ? (
          <>
            <WriterRef writer={entry.writer} agents={agents} />
            {` ${COMMENT_WORDS.ASKED} `}
            {asked === undefined ? null : (
              <WriterRef
                writer={{
                  actor: asked.actor,
                  ...(asked.agentId === undefined ? undefined : { agentId: asked.agentId }),
                }}
                agents={agents}
              />
            )}
          </>
        ) : (
          <>
            {entry.kind === PLAN_COMMENT_ENTRY.RESOLVED
              ? `${COMMENT_WORDS.RESOLVED_BY} `
              : `${COMMENT_WORDS.REOPENED_BY} `}
            <WriterRef writer={entry.writer} agents={agents} />
          </>
        )}
      </ActorLine>
      <span className="comment-time comment-event-time">
        {"· "}
        <RelativeTime at={entry.at} now={now} ago />
      </span>
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
}: {
  thread: PlanCommentThread;
  entry: PlanCommentEntry;
  first: boolean;
  doors: ThreadDoors;
  now: number;
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
      <div className="comment-head">
        <WriterRef writer={entry.writer} agents={doors.agents} />
        <span className="comment-time">
          <RelativeTime at={entry.at} now={now} ago />
          {entry.editedAt === undefined ? null : ` · ${COMMENT_WORDS.EDITED}`}
        </span>
      </div>
      {editing === undefined ? (
        <div className="comment-words">{entry.words}</div>
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
            <button type="button" className="quiet-button" onClick={() => setEditing(undefined)}>
              {COMMENT_WORDS.CANCEL}
            </button>
            <button type="button" className="primary-button comment-save" onClick={save}>
              {COMMENT_WORDS.SAVE}
            </button>
          </div>
        </div>
      )}
      <div className="comment-tools">
        {first ? (
          <Tooltip label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}>
            <button
              type="button"
              className="icon-button"
              aria-label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}
              onClick={() =>
                void doors.control.act(thread.id, {
                  action: settle ? PLAN_COMMENT_ACTION.RESOLVE : PLAN_COMMENT_ACTION.REOPEN,
                })
              }
            >
              {settle ? <CheckIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
            </button>
          </Tooltip>
        ) : null}
        <Tooltip label={COMMENT_WORDS.MORE}>
          <button
            type="button"
            className="icon-button"
            aria-label={COMMENT_WORDS.MORE}
            {...trigger}
          >
            <EllipsisIcon />
          </button>
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
    </div>
  );
}

/**
 * A comment's words as they are typed: Return sends, Shift-Return breaks the
 * line, and Esc lets the field go. A plain field, so the field's own undo
 * and redo change its words and never the plan's.
 */
function CommentText({
  value,
  label,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  autoFocus?: boolean;
}): React.JSX.Element {
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

/** Who a thread may be sent to, and the door that sends it: the draft posted first where one stands. */
interface SendTo {
  readonly agents: EditAgents | undefined;
  readonly onAsk: (
    to: PlanCommentAsked,
    draft: { words: string; clientKey: string } | undefined,
  ) => Promise<boolean>;
}

/**
 * The one Send to control: Luke first, for reasoning about the plan, then the
 * task's coding agents by name, each with its model, for changing code.
 * Picking one asks it to read the thread with the plan and answer in it.
 */
function SendToMenu({
  sendTo,
  onPick,
}: {
  sendTo: SendTo;
  onPick: (to: PlanCommentAsked) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const trigger = menu.trigger();
  const control = sendTo.agents?.control;
  const agents = (control?.agents ?? []).filter((agent) => agent.archivedAt === undefined);
  const luke: MenuAction = {
    label: "Luke",
    icon: <ActorMark actor={LUKE_ACTOR} />,
    detail: "Thinks about the plan",
    onSelect: () => onPick({ actor: PLAN_COMMENT_ACTOR.LUKE }),
  };
  const coding: MenuAction[] = agents.map((agent) => ({
    label: agentTabLabel(agent, control?.models),
    icon: (
      <WriterMark
        writer={{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId: agent.id }}
        agents={sendTo.agents}
      />
    ),
    detail: modelLabel(agent.model, control?.models),
    onSelect: () => onPick({ actor: PLAN_COMMENT_ACTOR.AGENT, agentId: agent.id }),
  }));
  return (
    <>
      <button type="button" className="toolbar-button comment-send-to" {...trigger}>
        {COMMENT_WORDS.SEND_TO}
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={COMMENT_WORDS.SEND_TO}
          menu={menu.drawn}
          groups={coding.length === 0 ? [[luke]] : [[luke], coding]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The field under a thread that answers it, or starts it where it is the thread being started. */
function ReplyField({
  label,
  sending,
  onSend,
  onCancel,
  autoFocus,
  sendTo,
}: {
  label: string;
  sending: boolean;
  /** Sends the words under a key that stays the same while they do, so a send tried again after a lost answer is taken once. */
  onSend: (words: string, clientKey: string) => Promise<boolean>;
  onCancel: () => void;
  autoFocus: boolean;
  /** Who the thread may be sent to; none for a thread not yet posted. */
  sendTo?: SendTo | undefined;
}): React.JSX.Element {
  const [words, setWords] = useState("");
  const attempt = useRef<{ words: string; key: string } | undefined>(undefined);
  const send = () => {
    const trimmed = words.trim();
    if (trimmed === "" || sending) return;
    const key = attempt.current?.words === trimmed ? attempt.current.key : crypto.randomUUID();
    attempt.current = { words: trimmed, key };
    void onSend(trimmed, key).then((sent) => {
      if (!sent) return;
      attempt.current = undefined;
      setWords("");
    });
  };
  return (
    <div className="comment-field field-well">
      <CommentText
        value={words}
        label={label}
        onChange={setWords}
        onSubmit={send}
        onCancel={onCancel}
        autoFocus={autoFocus}
      />
      <div className="comment-field-foot">
        {sendTo === undefined ? (
          <span />
        ) : (
          <SendToMenu
            sendTo={sendTo}
            onPick={(to) => {
              const trimmed = words.trim();
              const key =
                attempt.current?.words === trimmed ? attempt.current.key : crypto.randomUUID();
              if (trimmed !== "") attempt.current = { words: trimmed, key };
              void sendTo
                .onAsk(to, trimmed === "" ? undefined : { words: trimmed, clientKey: key })
                .then((sent) => {
                  if (!sent || trimmed === "") return;
                  attempt.current = undefined;
                  setWords("");
                });
            }}
          />
        )}
        <button
          type="button"
          className="comment-send"
          aria-label={label === COMMENT_WORDS.ADD ? COMMENT_WORDS.COMMENT : COMMENT_WORDS.REPLY}
          disabled={words.trim() === "" || sending}
          onClick={send}
        >
          <ArrowUpIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Over a thread whose words were deleted: that they were, and what they said. */
function GoneQuote({ thread }: { thread: PlanCommentThread }): React.JSX.Element {
  return (
    <>
      <div className="comment-gone">
        <TrashIcon />
        {COMMENT_WORDS.GONE}
      </div>
      <blockquote className="comment-quote" data-gone="true">
        {thread.quote}
      </blockquote>
    </>
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
}: {
  thread: PlanCommentThread;
  open: boolean;
  doors: ThreadDoors;
  onOpen: () => void;
  onClose: () => void;
  /** Whether the quote stands over it, as in the Comments tab, where its words are not beside it. */
  quote?: boolean;
  /** Whether the pointer is on the thread's words, which the card at rest answers as it answers the pointer itself. */
  pointed?: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const [sending, setSending] = useState(false);
  // A send that failed is retried under its own key, so a send whose answer was lost hands the thread over once.
  const askAttempt = useRef<{ to: string; key: string } | undefined>(undefined);
  const comments = thread.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT);
  const [first] = comments;
  const gone = thread.anchor === undefined;
  const note = doors.control.notes.get(thread.id);
  const head = (
    <>
      {gone ? <GoneQuote thread={thread} /> : null}
      {!gone && quote ? <blockquote className="comment-quote">{thread.quote}</blockquote> : null}
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
      if (inner === null || inner.classList.contains("comment-open")) onOpen();
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
        {/* Note that the words and the replies are one press that opens the thread, the writer's name its own. */}
        <button type="button" className="comment-open">
          <span className="comment-words" data-clamped="true">
            {first?.words}
          </span>
          {replies.length === 0 ? null : (
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
      {head}
      {thread.entries.map((entry) =>
        entry.kind === PLAN_COMMENT_ENTRY.COMMENT ? (
          <CommentEntry
            key={entry.id}
            thread={thread}
            entry={entry}
            first={entry.id === first?.id}
            doors={doors}
            now={now}
          />
        ) : (
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
          onCancel={onClose}
          sendTo={{
            agents: doors.agents,
            // Note that a draft standing as the thread is sent is posted first, so it is part of what is asked.
            onAsk: async (to, draft) => {
              setSending(true);
              const posted =
                draft === undefined ||
                (await doors.control.act(thread.id, {
                  action: PLAN_COMMENT_ACTION.REPLY,
                  ...draft,
                }));
              const recipient = `${to.actor}:${to.agentId ?? ""}`;
              if (askAttempt.current?.to !== recipient) {
                askAttempt.current = { to: recipient, key: crypto.randomUUID() };
              }
              const asked =
                posted &&
                (await doors.control.act(thread.id, {
                  action: PLAN_COMMENT_ACTION.ASK,
                  clientKey: askAttempt.current.key,
                  to,
                }));
              if (asked) askAttempt.current = undefined;
              setSending(false);
              return asked;
            },
          }}
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
  const nested = [...block.childNodes].findIndex(
    (child) => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL"),
  );
  const range = document.createRange();
  range.selectNodeContents(block);
  if (nested >= 0) range.setEnd(block, nested);
  const quote = range.toString().trimEnd();
  return { quote, from, to: from + quote.length };
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
  return span === undefined ? undefined : { ...span, scope, quote: quote.slice(0, 2_000) };
}

/** Where an element's top stands in the plan body's own box. */
function topIn(body: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - body.getBoundingClientRect().top;
}

/** The bar at the end of a block a thread is on whole: where it stands in the body, and whether its thread is open. */
interface BlockEdge {
  readonly thread: string;
  readonly top: number;
  readonly height: number;
  readonly active: boolean;
}

/** The blocks threads are on whole, each bar spanning every mark its thread's words wear, so it stands beside a bullet, a paragraph, or a whole list alike. */
function blockEdges(body: HTMLElement | null): readonly BlockEdge[] {
  if (body === null) return [];
  const spans = new Map<string, { top: number; bottom: number; active: boolean }>();
  for (const mark of body.querySelectorAll<HTMLElement>(
    `.${COMMENT_MARK_CLASS}[data-block-threads]`,
  )) {
    const rect = mark.getBoundingClientRect();
    const top = topIn(body, mark);
    const bottom = top + rect.height;
    const active = mark.dataset.blockActive === "true";
    for (const thread of (mark.dataset.blockThreads ?? "").split(" ")) {
      if (thread === "") continue;
      const held = spans.get(thread);
      spans.set(
        thread,
        held === undefined
          ? { top, bottom, active }
          : {
              top: Math.min(held.top, top),
              bottom: Math.max(held.bottom, bottom),
              active: held.active || active,
            },
      );
    }
  }
  return [...spans].map(([thread, span]) => ({
    thread,
    top: span.top,
    height: span.bottom - span.top,
    active: span.active,
  }));
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
  // Note that a thread's id is the service's UUID, which a selector takes as it is.
  openThreadSheet.replaceSync(
    thread === undefined
      ? ""
      : `.plan-document-text .${COMMENT_MARK_CLASS}[data-threads~="${thread}"] { border-bottom-color: var(--comment-mark-active-edge); background: var(--comment-mark-active); } .plan-document-text .${COMMENT_MARK_CLASS}[data-block="true"][data-threads~="${thread}"] { background: var(--comment-mark); }`,
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
  const [edges, setEdges] = useState<readonly BlockEdge[]>([]);
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
    const nextEdges = blockEdges(body.current);
    if (JSON.stringify(nextEdges) !== JSON.stringify(edges)) setEdges(nextEdges);
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
  // A press anywhere but the thread, its words, or what it opened over the page closes it; one being written stays, so its draft is never lost.
  useEffect(() => {
    if (active === undefined || active === PENDING_THREAD) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(KEEPS_THREAD_OPEN) !== null) {
        return;
      }
      onActive(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active, onActive]);
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
  const edgesDrawn = edges.map((edge) => (
    <div
      key={edge.thread}
      className="comment-block-edge"
      // Note that the editor's marks never change with the open thread, so the bar reads it from the layer.
      data-active={edge.active || edge.thread === active}
      style={{ top: edge.top, height: edge.height }}
    />
  ));
  const blockButton =
    // Note that folded, a line holding a count opens its threads there, so its block shows no button over it.
    hovered === undefined ||
    (!wide && [...anchors.values()].some((top) => Math.abs(top - hovered.top) < 4)) ? null : (
      <div className="comment-block-button" data-folded={!wide} style={{ top: hovered.top }}>
        <Tooltip label={COMMENT_WORDS.COMMENT}>
          <button
            type="button"
            className="icon-button"
            aria-label={COMMENT_WORDS.COMMENT}
            // Note that the press takes no focus, so an open editor stays to measure the block through.
            onMouseDown={(event) => event.preventDefault()}
            onClick={hovered.start}
          >
            <MessageSquarePlusIcon aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    );
  const bubbleDrawn =
    bubble === undefined ? null : (
      <div className="comment-bubble menu-surface" style={{ top: bubble.top, left: bubble.left }}>
        <button
          type="button"
          className="toolbar-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={bubble.start}
        >
          <MessageSquarePlusIcon aria-hidden="true" />
          {COMMENT_WORDS.COMMENT}
        </button>
      </div>
    );
  if (wide) {
    return (
      <div className="comment-layer">
        {edgesDrawn}
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
      {edgesDrawn}
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
          <button
            key={top}
            type="button"
            className="comment-count"
            style={{ top }}
            aria-expanded={threads.some((thread) => thread.id === active)}
            aria-label={`${comments} ${comments === 1 ? "comment" : "comments"}`}
            onClick={() =>
              onActive(threads.some((thread) => thread.id === active) ? undefined : first?.id)
            }
          >
            <MessageSquareIcon aria-hidden="true" />
            {comments}
          </button>
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

/** What the Comments tab says over a list holding nothing, by its filter. */
const NO_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: "No open comments.",
  [COMMENTS_FILTER.RESOLVED]: "No resolved comments.",
} as const satisfies Record<CommentsFilter, string>;

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
  const [opened, setOpened] = useState<string | undefined>(undefined);
  // A resolved thread asked to be shown, as a link to it asks, opens here under Resolved, the plan holding no card of it.
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
    setOpened(resolvedAsked.id);
  }, [revealed, resolvedAsked]);
  if (control === undefined) return null;
  const open = control.threads.filter(openThread);
  const resolved = control.threads.filter((thread) => !openThread(thread));
  const listed = filter === COMMENTS_FILTER.OPEN ? open : resolved;
  const full = { ...doors, control };
  return (
    <div className="comments-tab">
      <div className="comments-filters">
        {[
          [COMMENTS_FILTER.OPEN, "Open", open.length] as const,
          [COMMENTS_FILTER.RESOLVED, "Resolved", resolved.length] as const,
        ].map(([kind, label, count]) => (
          <button
            key={kind}
            type="button"
            className="comments-filter"
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {label}
            <span className="comments-filter-count">{count}</span>
          </button>
        ))}
      </div>
      {control.failed ? (
        <div className="comments-empty" role="alert">
          The comments could not be read.{" "}
          <button type="button" className="quiet-button" onClick={control.onRetry}>
            Try again
          </button>
        </div>
      ) : listed.length === 0 ? (
        <div className="comments-empty">{control.read ? NO_COMMENTS[filter] : null}</div>
      ) : (
        listed.map((thread) => (
          <div key={thread.id} className="comments-row">
            <div className="comments-row-section">
              {thread.section === "" ? "Plan" : thread.section}
            </div>
            <ThreadCard
              thread={thread}
              open={opened === thread.id}
              quote
              doors={full}
              onOpen={() => {
                if (openThread(thread)) {
                  onShowDocument();
                  reveal(thread.id);
                } else setOpened(thread.id);
              }}
              onClose={() => setOpened(undefined)}
            />
          </div>
        ))
      )}
    </div>
  );
}
