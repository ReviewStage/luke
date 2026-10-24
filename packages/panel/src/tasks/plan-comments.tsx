import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  base64Bytes,
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
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
import { IRREVERSIBLE_WORDS, pasteCutWords } from "@luke/features/words";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_CORNER,
  CARD_HOVER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_PRESS_CORNER,
  CARD_PRESS_REACH,
  CARD_SHADOW,
  Card,
  type CardHover,
  type CardLook,
  CardPress,
  type CardShadow,
  COMPOSER_LOOK,
  CONFIRM_LOSS,
  Comment,
  type CommentAuthor,
  CommentsIcon,
  ComposerFoot,
  ComposerFrame,
  ConfirmDialog,
  type DialogQuestion,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FailureNote,
  Fill,
  IconButton,
  LINE_BUTTON_LOOK,
  LineButton,
  MENU_SURFACE_FLOW,
  MenuSurface,
  MoreButton,
  moreLabel,
  PaneBar,
  SCROLL_FADE,
  ScrollArea,
  Skeleton,
  SkeletonRegion,
  TEXT_AREA_GROW_LIMIT,
  TEXT_AREA_LOOK,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextButton,
  Time,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useMenu,
  useMinute,
  usePressAway,
  VisuallyHidden,
} from "@luke/ui";
import { type Actor, LUKE_ACTOR } from "@luke/ui/actor-model";
import {
  CheckIcon,
  CircleCheckIcon,
  GLYPH,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
} from "@luke/ui/icons";
import {
  marginTops,
  openThread,
  PENDING_THREAD,
  type PendingThread,
  type PlanCommentsControl,
  usePlanCommentsControl as usePlanCommentsControlOrUndefined,
} from "@luke/ui/plan-comments";
import { visibleViewport } from "@luke/ui/visible-viewport";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Equal, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
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
import { ActorMark, ActorRef, commentAuthor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useSideBundles } from "../bundle-loader.js";
import { coarsePointerNow, FINGER_SELECTION_GAP } from "../coarse-pointer.js";
import {
  DRAFT_PLACE,
  type DraftPlace,
  EMPTY_DRAFT,
  type PlanCommentPlace,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { enterSubmitKey } from "../enter-sends.js";
import { MarkdownMessage } from "../markdown-message.js";
import { usePerson } from "../member-directory.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type EditorSpan,
  type PlanEditorHandle,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { useBusyPress } from "../settings/busy-press.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { keptKey, useKept } from "../use-kept.js";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import type { EditAgents } from "./edit-ref.js";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker.js";
import { CommentFiles } from "./plan-comment-files.js";
import { EDITOR_ROOM_CLASS } from "./plan-document-editor.js";
import { type TaskMentionsValue, useMentionLink, useTaskMentions } from "./task-mentions.js";
import { DICTATION_PHASE, type DictationControl, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenLink } from "./use-open-link.js";
import {
  useWordsDatePicker,
  WordsDatePickerRoom,
  type WordsDates,
  WordsDatesContext,
  wordsDatesDoor,
} from "./words-dates.js";

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
 * under the pointer, which comments on the whole block; while the bubble
 * stands, ⌥⌘M starts it as a press on the bubble does
 * (`APP_COMMAND.COMMENT_ON_SELECTION`). In the open editor the format
 * toolbar over the words selected takes the bubble's place, its Comment
 * starting the thread (`useEditorComment`), so two surfaces never stand over
 * one selection. Its words are
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

/** What a mention's chip wears, whose press opens the thread at rest it stands in as well as what it names. */
const MENTION_REF = "[data-mention-ref]";

/** How far apart two cards of the margin stand. */
const CARD_GAP = 8;

/** Where a thread's card stands: in the plan's margin, floating under a folded line's count, or in the Comments tab. */
const THREAD_PLACE = {
  MARGIN: "margin",
  FLOAT: "float",
  LIST: "list",
} as const;

type ThreadPlace = (typeof THREAD_PLACE)[keyof typeof THREAD_PLACE];

/** The room a finger's bubble needs under the words, its gap past the handle and its own height, short of which it stands over them after all. */
const BUBBLE_ROOM_TOUCH = FINGER_SELECTION_GAP + 48;

/** The words a thread's controls are named by. */
const COMMENT_WORDS = {
  COMMENT: "Comment",
  ADD: "Add a comment",
  REPLY: "Reply",
  RESOLVE: "Resolve",
  RESOLVING: "Resolving",
  REOPEN: "Reopen",
  REOPENING: "Reopening",
  THING: "Comment",
  EDIT: "Edit",
  DELETE: "Delete",
  DELETE_THREAD: "Delete thread",
  SAVE: "Save",
  SAVING: "Saving",
  CANCEL: "Cancel",
  GONE: "Original content deleted",
  RESOLVED_IT: "resolved this",
  REOPENED_IT: "reopened this",
  EDITED: "edited",
  OPEN_THREAD: "Open thread",
  SHOW_WORDS: "Show in the plan",
  SENDING: "Sending",
  DISCARD: "Discard",
  NOT_SENT: "This comment could not be sent.",
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

/** Who wrote an entry as a comment draws them: their face, and their name as every place naming an actor draws it. */
function useWriter(
  writer: PlanCommentWriter,
  agents: EditAgents | undefined,
): { author: CommentAuthor; nameRef: ReactNode } {
  const person = usePerson(writer.by);
  if (writer.actor === PLAN_COMMENT_ACTOR.LUKE) {
    return { author: commentAuthor(LUKE_ACTOR), nameRef: <ActorRef actor={LUKE_ACTOR} nameOnly /> };
  }
  if (
    writer.actor === PLAN_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    const { agentId } = writer;
    const subject = agentSubject(agents.control, agentId, NOTHING_HELD, false);
    return {
      author: commentAuthor(subject.tile),
      nameRef: (
        <AgentActorRef
          subject={subject}
          models={agents.control.models}
          onOpen={() => agents.onOpen?.(agentId)}
          nameOnly
        />
      ),
    };
  }
  return { author: commentAuthor(person), nameRef: <ActorRef actor={person} nameOnly /> };
}

/** One entry of a thread as a comment (`Comment`): its writer's face and name, when it was written, what stands at the head's end, then its words. */
function WrittenComment({
  writer,
  agents,
  said,
  at,
  now,
  trailing,
  children,
}: {
  writer: PlanCommentWriter;
  agents: EditAgents | undefined;
  /** What the writer did, said after their name, for a line of what happened to a thread. */
  said?: string;
  at: number;
  now: number;
  trailing?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const { author, nameRef } = useWriter(writer, agents);
  return (
    <Comment
      author={author}
      nameRef={
        said === undefined ? (
          nameRef
        ) : (
          <>
            {nameRef}
            <span className="comment-event-words">{` ${said}`}</span>
          </>
        )
      }
      at={at}
      now={now}
      trailing={trailing}
    >
      {children}
    </Comment>
  );
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
      <WrittenComment
        writer={entry.writer}
        agents={agents}
        said={
          entry.kind === PLAN_COMMENT_ENTRY.RESOLVED
            ? COMMENT_WORDS.RESOLVED_IT
            : COMMENT_WORDS.REOPENED_IT
        }
        at={entry.at}
        now={now}
      />
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
  body: `The comment is deleted for everyone. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

const DELETE_THREAD_QUESTION: DialogQuestion = {
  title: "Delete this thread?",
  body: `Every comment in it is deleted with it. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete thread",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

/** What discarding a send not sent asks first, since its words and files are kept nowhere else. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard this comment?",
  body: `Its words and files are kept nowhere else. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
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
  // The edit's words, kept where they differ from the comment's, so a Cancel or an Esc finds them as the box reopens.
  const edited = useDraft({
    kind: DRAFT_PLACE.PLAN_COMMENT,
    planId: doors.control.planId,
    on: { threadId: thread.id, entryId: entry.id },
  });
  const drafts = useDraftWriter();
  const deleting = useConfirmDialog({ subject: true, surfaceOpen: true }, async () => {
    const deleted = await doors.control.act(
      thread.id,
      first
        ? { action: PLAN_COMMENT_ACTION.DELETE_THREAD }
        : { action: PLAN_COMMENT_ACTION.DELETE, entry: entry.id },
    );
    if (!deleted) {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: doors.control.notes.get(thread.id) ?? COMMENT_NOT_DELETED,
      };
    }
    // Words left unsent on what went go with it, so no plan is marked holding a draft no box opens.
    drafts.drop((place) => writtenOn(place, thread.id, first ? undefined : entry.id));
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  });
  const copyLink = useCopyLinkItem()({
    kind: LINK_PLACE.COMMENT,
    planId: doors.control.planId,
    threadId: thread.id,
  });
  const menu = useMenu(true);
  const trigger = menu.trigger();
  const mine = writtenByReader(entry, doors.me);
  // Note that a thread's starter deletes it whole, or any member where Luke or an agent started it, as the service holds it to.
  const items: MenuAction[] = [
    ...(copyLink === undefined ? [] : [copyLink]),
    ...(mine
      ? [
          {
            label: COMMENT_WORDS.EDIT,
            icon: <GLYPH.RENAME />,
            onSelect: () =>
              setEditing(edited.draft.text === "" ? (entry.words ?? "") : edited.draft.text),
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
    ...(first && (mine || entry.writer.actor !== PLAN_COMMENT_ACTOR.MEMBER)
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
  // Note that the check is busy from its press until the service answers, so a slow answer is seen working, and a refusal is the thread's note to say.
  const settling = useBusyPress(() =>
    doors.control.act(thread.id, {
      action: settle ? PLAN_COMMENT_ACTION.RESOLVE : PLAN_COMMENT_ACTION.REOPEN,
    }),
  );
  const [saving, setSaving] = useState(false);
  // The reader's own words take a date changed from its chip, as their editor would, saved as an edit of the comment.
  const openDate = useWordsDatePicker();
  const latestWords = useRef(entry.words);
  latestWords.current = entry.words;
  const { control } = doors;
  const dates = useMemo<WordsDates | undefined>(
    () =>
      !mine || openDate === undefined
        ? undefined
        : wordsDatesDoor(
            openDate,
            () => latestWords.current,
            (words) => {
              // Note that a comment is never saved empty, so Clear on a comment of a date alone leaves it.
              if (words.trim() === "") return;
              void control.act(thread.id, {
                action: PLAN_COMMENT_ACTION.EDIT,
                entry: entry.id,
                words: words.trim(),
              });
            },
          ),
    [mine, openDate, control, thread.id, entry.id],
  );
  const write = (words: string) => {
    setEditing(words);
    // Note that words as the comment holds them, or none, keep no draft, so the box reopens on the comment as it stands.
    edited.update((was) => ({
      ...was,
      text: words.trim() === "" || words === entry.words ? "" : words,
    }));
  };
  const save = () => {
    const words = editing?.trim() ?? "";
    // Note that a comment is never saved empty, so an edit emptied asks to delete it, as its menu's Delete does.
    if (words === "") {
      deleting.ask();
      return;
    }
    if (saving) return;
    setSaving(true);
    void doors.control
      .act(thread.id, { action: PLAN_COMMENT_ACTION.EDIT, entry: entry.id, words })
      .then((done) => {
        if (!done) return;
        setEditing(undefined);
        edited.update(() => EMPTY_DRAFT);
      })
      .finally(() => setSaving(false));
  };
  return (
    <div className="comment-entry" data-entry={entry.id}>
      {/* Note that the tools stand at the head's end, shown under the pointer or the keyboard, so a long name gives way to them and nothing stands over it. */}
      <WrittenComment
        writer={entry.writer}
        agents={doors.agents}
        at={entry.at}
        now={now}
        trailing={
          <>
            {entry.editedAt === undefined ? null : (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                {COMMENT_WORDS.EDITED}
              </Text>
            )}
            <div className="comment-tools">
              {first ? (
                <Tooltip label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}>
                  <IconButton
                    size={BUTTON_SIZE.COMPACT}
                    icon={settle ? <CheckIcon /> : <RotateCcwIcon />}
                    label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}
                    busy={settling.busy}
                    busyLabel={settle ? COMMENT_WORDS.RESOLVING : COMMENT_WORDS.REOPENING}
                    onClick={settling.onPress}
                  />
                </Tooltip>
              ) : null}
              <MoreButton thing={COMMENT_WORDS.THING} size={BUTTON_SIZE.COMPACT} {...trigger} />
              {menu.drawn === undefined ? null : (
                <ActionMenu
                  label={moreLabel(COMMENT_WORDS.THING)}
                  menu={menu.drawn}
                  groups={[items]}
                  onClose={menu.close}
                />
              )}
            </div>
            <ConfirmDialog
              open
              confirm={deleting}
              question={first ? DELETE_THREAD_QUESTION : DELETE_QUESTION}
            />
          </>
        }
      >
        {lead}
        {editing === undefined ? (
          <>
            {/* Note that a comment's files stand over its words, as the field held them and as every message's do. */}
            {entry.files === undefined ? null : (
              <CommentFiles planId={doors.control.planId} files={entry.files} />
            )}
            <WordsDatesContext.Provider value={dates}>
              <CommentWords words={entry.words ?? ""} />
            </WordsDatesContext.Provider>
          </>
        ) : (
          <ComposerFrame look={COMPOSER_LOOK.FIELD} className="comment-field comment-editing">
            <CommentText
              value={editing}
              label={COMMENT_WORDS.EDIT}
              onChange={write}
              onSubmit={save}
              onCancel={() => setEditing(undefined)}
              autoFocus
            />
            <div className="comment-field-foot">
              <Button onClick={() => setEditing(undefined)}>{COMMENT_WORDS.CANCEL}</Button>
              <Button
                variant={BUTTON_VARIANT.PRIMARY}
                busy={saving}
                busyLabel={COMMENT_WORDS.SAVING}
                onClick={save}
              >
                {COMMENT_WORDS.SAVE}
              </Button>
            </div>
          </ComposerFrame>
        )}
      </WrittenComment>
    </div>
  );
}

/** A comment's words as Markdown, its mentions drawn as their chips, as a message's are. */
function CommentWords({ words }: { words: string }): React.JSX.Element {
  const link = useMentionLink();
  const openLink = useOpenLink();
  return (
    <MarkdownMessage words={words} className="comment-words" link={link} openLink={openLink} />
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
  /** Takes files pasted into the field, answering whether it took any; none where the field takes no files, as an edit's does not. */
  readonly onPasteFiles?: ((files: readonly File[]) => boolean) | undefined;
  /** Told once a paste past the comment's bound has been cut to fit; none where the field says nothing of it. */
  readonly onPasteCut?: (() => void) | undefined;
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
  onPasteFiles,
  onPasteCut,
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
      aria={{ ...picker.aria, "aria-placeholder": label }}
      onKey={(event) => {
        if (dictation?.onFieldKey(event) === true || picker.onKey(event)) return true;
        if (event.key !== "Escape") return false;
        event.preventDefault();
        onCancel();
        return true;
      }}
      onEnter={onSubmit}
      onPasteFiles={onPasteFiles ?? (() => false)}
      onPasteCut={onPasteCut}
      onTrigger={() => undefined}
      chip={() => null}
      mentions={{
        onTrigger: picker.onTrigger,
        chip: (mention, node) => (
          <MentionNodeChip
            mention={mention}
            doors={mentions.doors}
            edit={{ node, pickDate: picker.pickDate }}
          />
        ),
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
 * A comment's words as they are typed: Return sends, as `enterSends` reads
 * it, so a finger's keyboard breaks the line with it, Shift-Return breaks
 * the line, and Esc lets the field go. A plain field, so the field's own undo
 * and redo change its words and never the plan's.
 */
function PlainCommentText({
  value,
  label,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
  onPasteFiles,
}: CommentTextProps): React.JSX.Element {
  return (
    <TextArea
      look={TEXT_AREA_LOOK.BARE}
      growLimit={TEXT_AREA_GROW_LIMIT.NONE}
      grow
      rows={1}
      value={value}
      placeholder={label}
      label={label}
      // biome-ignore lint/a11y/noAutofocus: the field is opened by the press that asked for it, as a reply field is.
      autoFocus={autoFocus}
      onChange={onChange}
      onPaste={(event) => {
        // Note that only files the field takes stop the paste, so text pastes as it always does.
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0 && onPasteFiles?.(files) === true) event.preventDefault();
      }}
      submitKey={enterSubmitKey()}
      onSubmit={onSubmit}
      onEscape={onCancel}
    />
  );
}

/** The field under a thread that answers it, or starts it where it is the thread being started. */
function ReplyField({
  label,
  place,
  writer,
  sending,
  onSend,
  onCancel,
  autoFocus,
  failure,
  variant = REPLY_VARIANT.REPLY,
}: {
  label: string;
  /** Where the words are kept unsent, so Esc, a press away, or the thread closing finds them as the field opens again. */
  place: PlanCommentPlace;
  /** Who writes them, the reader, whose sends marked as not sent are theirs alone. */
  writer: string | undefined;
  sending: boolean;
  /** Sends the words and the files under a key that stays the same while they do, so a send tried again after a lost answer is taken once. */
  onSend: (
    words: string,
    clientKey: string,
    attachments: readonly CodingAgentAttachment[],
  ) => Promise<boolean>;
  onCancel: () => void;
  autoFocus: boolean;
  /** Why the last act on the thread did not go, which the foot says under the box; none while nothing failed. */
  failure?: string | undefined;
  /** A thread's first comment, which is the card itself, or a reply under its comments, which stays a line until it is used. */
  variant?: ReplyVariant;
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const [heard, setHeard] = useState<string | undefined>(undefined);
  const dictation = useDictation({ editor, keywords: NO_KEYWORDS, onNote: setHeard });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  // Note that only the agent box's editor takes a dictation, so the plain field offers none.
  const dictates = useCommentEditor() !== undefined;
  const { draft, update } = useDraft(place);
  const words = draft.text;
  // Whether the last paste was cut to the room the field has left, until the words change again.
  const [cut, setCut] = useState(false);
  const setWords = (text: string) => {
    setCut(false);
    update((was) => ({ ...was, text }));
  };
  // Why the last files handed to the field did not all come; nothing once they did.
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const files = useAttachedFiles({ onRefusal: setRefusal });
  // The words sent and not yet answered, which the field holds as a draft while it stands empty, so a send that fails finds them.
  const [inFlight, setInFlight] = useState("");
  const attempt = useRef<CommentSend | undefined>(undefined);
  // A refused send the field could not take back beside what was typed or added since, kept apart, marked as not sent, with Retry under its key.
  const unsent = useAtomValue(
    unsentAtom,
    (all) => all.find((each) => each.writer === writer && Equal.equals(each.place, place))?.send,
  );
  const keepUnsent = useAtomSet(unsentAtom);
  const setUnsent = (send: CommentSend | undefined) =>
    keepUnsent((all) => [
      ...all.filter((each) => each.writer !== writer || !Equal.equals(each.place, place)),
      ...(send === undefined ? [] : [{ writer, place, send }]),
    ]);
  // The words the field holds this moment, for a send's answer that lands after the render it was made in.
  const wordsNow = useRef(words);
  wordsNow.current = words;
  // Note that a dictation's note is said before the cut paste's, and only the agent box's editor cuts a paste.
  const said = heard ?? (cut ? pasteCutWords(PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS) : undefined);
  // Note that a failed send is said over a refused file, which is said over a dictation's note or a cut paste, and stands on the not-sent line where there is one.
  const note = (unsent === undefined ? failure : undefined) ?? refusal ?? said;
  const go = (out: CommentSend) => {
    setInFlight(out.words);
    void onSend(out.words, out.key, out.attachments).then((sent) => {
      setInFlight("");
      if (sent) {
        attempt.current = undefined;
        return;
      }
      // Note that a refused send goes back above whatever was typed or added since, so neither is dropped, unless the two together are more than one comment carries.
      const held = wordsNow.current;
      const back = {
        words: held.trim() === "" ? out.words : `${out.words}\n\n${held}`,
        attachments: [...out.attachments, ...files.now()],
      };
      if (!carried(back)) {
        setUnsent(out);
        return;
      }
      update((now) => ({ ...now, text: back.words }));
      files.set(back.attachments);
    });
  };
  const send = () => {
    const trimmed = words.trim();
    // Note that a send not sent goes first, so comments land in the order they were written.
    if (trimmed === "" || sending || files.reading || unsent !== undefined) return;
    const { attachments } = files;
    const was = attempt.current;
    const same = was?.words === trimmed && sameFiles(was.attachments, attachments);
    const key = same && was !== undefined ? was.key : crypto.randomUUID();
    attempt.current = { words: trimmed, attachments, key };
    // Note that the field empties as the words are sent, since a send may wait on the ones its mentions hand the thread to.
    setWords("");
    files.set([]);
    go(attempt.current);
  };
  const retry = () => {
    if (unsent === undefined || sending) return;
    setUnsent(undefined);
    go(unsent);
  };
  // Note that Discard asks first, since a send not sent is kept nowhere else.
  const discard = useConfirmDialog({ subject: unsent !== undefined, surfaceOpen: true }, () => {
    setUnsent(undefined);
    // Note that words written again after a discard are a new comment, so they go under a new key.
    attempt.current = undefined;
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  return (
    <ComposerFrame
      look={variant === REPLY_VARIANT.FIRST ? COMPOSER_LOOK.BARE : COMPOSER_LOOK.CARD}
      className="comment-field"
      data-variant={variant}
      dropping={files.drop.dropping}
      // Note that the words in flight, held files and files still being read, and a dictation whose words land once heard, hold the field, so a press away keeps a thread being started; typed words are kept as its draft and hold nothing.
      data-held={
        inFlight.trim() !== "" || files.attachments.length > 0 || files.reading || dictating
      }
      {...files.drop.target}
    >
      {unsent === undefined ? null : (
        <div className="comment-unsent" data-unsent="">
          <AttachedFileChips files={attachmentChips(unsent.attachments)} />
          <CommentWords words={unsent.words} />
          <FailureNote
            onRetry={retry}
            also={
              <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={discard.ask}>
                {COMMENT_WORDS.DISCARD}
              </TextButton>
            }
          >
            {failure ?? COMMENT_WORDS.NOT_SENT}
          </FailureNote>
          <ConfirmDialog open confirm={discard} question={DISCARD_QUESTION} />
        </div>
      )}
      <CommentText
        value={words}
        label={label}
        onChange={setWords}
        onSubmit={send}
        onCancel={onCancel}
        autoFocus={autoFocus}
        editor={editor}
        dictation={dictation}
        onPasteFiles={files.paste}
        onPasteCut={() => {
          // Note that a paste cut says so over a dictation's note, which was said of what came before it.
          setHeard(undefined);
          setCut(true);
        }}
      />
      <ComposerFoot
        files={
          <AttachedFileChips
            files={attachmentChips(files.attachments)}
            onRemove={sending ? undefined : files.remove}
          />
        }
        tools={<AttachFilesButton disabled={sending} onFiles={files.attach} />}
        counter={
          dictates
            ? { length: words.length, limit: PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS }
            : undefined
        }
        actions={dictates ? <DictateButton dictation={dictation} disabled={sending} /> : undefined}
        strip={dictating ? <DictationStrip dictation={dictation} /> : undefined}
        send={{
          label: label === COMMENT_WORDS.ADD ? COMMENT_WORDS.COMMENT : COMMENT_WORDS.REPLY,
          empty: words.trim() === "",
          held: files.reading || unsent !== undefined,
          onSend: send,
          busy: sending,
          busyLabel: COMMENT_WORDS.SENDING,
        }}
        // Note that a file refused is said over a dictation's note or a cut paste, as the agent box says it.
        note={note === undefined ? undefined : { words: note }}
      />
    </ComposerFrame>
  );
}

/** Whether a draft's place is a comment's of a thread: any of its own, or one comment's edit where `entryId` names it. */
function writtenOn(place: DraftPlace, threadId: string, entryId: string | undefined): boolean {
  if (place.kind !== DRAFT_PLACE.PLAN_COMMENT || !("threadId" in place.on)) return false;
  if (place.on.threadId !== threadId) return false;
  return entryId === undefined || ("entryId" in place.on && place.on.entryId === entryId);
}

/** One comment's words and files as they are sent, under the key a send tried again goes under. */
interface CommentSend {
  readonly words: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly key: string;
}

/**
 * Each window's sends marked as not sent, by who wrote them and the place
 * they were written in, kept past their field, so a thread closed and
 * opened again finds its line where it was left, and another account
 * signed in to the window reads none. Note that each window's registry
 * holds its own.
 */
const unsentAtom = Atom.keepAlive(
  Atom.make<
    readonly {
      readonly writer: string | undefined;
      readonly place: PlanCommentPlace;
      readonly send: CommentSend;
    }[]
  >([]),
);

/** Whether one comment carries these words and files: its words' bound, and a message's count of files and their bytes together. */
function carried(send: Pick<CommentSend, "words" | "attachments">): boolean {
  if (send.words.length > PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS) return false;
  if (send.attachments.length > CODING_AGENT_BOUNDS.MAX_ATTACHMENTS) return false;
  const bytes = send.attachments.reduce((sum, each) => sum + base64Bytes(each.data), 0);
  return bytes <= CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES;
}

/** Whether two sends carry the same files, each the very one read, in the same order. */
function sameFiles(
  was: readonly CodingAgentAttachment[],
  now: readonly CodingAgentAttachment[],
): boolean {
  return was.length === now.length && was.every((file, at) => file === now[at]);
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
    <blockquote className="comment-quote" data-gone={gone}>
      <Tooltip label={COMMENT_WORDS.SHOW_WORDS}>
        <LineButton look={LINE_BUTTON_LOOK.QUOTE} onClick={onShowWords}>
          {thread.quote}
        </LineButton>
      </Tooltip>
    </blockquote>
  );
}

/**
 * How a thread's card stands where it is: open over the page, raised on a
 * menu's shadow, as at rest under a count, where it floats with the open
 * one; at rest in the margin, its edge alone on the column's ground; and in
 * the Comments tab, where every thread stands whole on the panel's ground,
 * its edge alone.
 */
function threadFrame(place: ThreadPlace, open: boolean): { look: CardLook; shadow: CardShadow } {
  const raised = place === THREAD_PLACE.FLOAT || (open && place === THREAD_PLACE.MARGIN);
  return raised
    ? { look: CARD_LOOK.RAISED, shadow: CARD_SHADOW.MENU }
    : { look: CARD_LOOK.OUTLINE, shadow: CARD_SHADOW.NONE };
}

/**
 * A thread's card, raised or outlined by where it stands and whether it is
 * open (`threadFrame`), in a comment's own type and inset. Every thread
 * draws it, and so do the Comments tab's placeholder cards, so a thread
 * lands where its placeholder stood.
 */
function CommentCard({
  place,
  open,
  hover = CARD_HOVER.NONE,
  lit,
  children,
  ...data
}: {
  place: ThreadPlace;
  open: boolean;
  hover?: CardHover;
  lit?: boolean | undefined;
  "data-thread"?: string | undefined;
  "data-pointed"?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      {...threadFrame(place, open)}
      corner={CARD_CORNER.MENU}
      padding={CARD_PADDING.NONE}
      hover={hover}
      lit={lit}
      className="comment-card"
      data-open={String(open)}
      {...data}
    >
      {children}
    </Card>
  );
}

/** One row of the Comments tab's list, a step from the next: a thread's card, or a placeholder's. */
function CommentsRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="comments-row">{children}</div>;
}

/**
 * One thread as the margin, a count's card, or the Comments tab draws it:
 * open, every entry and the field that answers it; at rest, its first
 * comment and the faces and count of its replies, which opens it.
 */
function ThreadCard({
  thread,
  open,
  place,
  doors,
  onOpen,
  onClose,
  quote = false,
  pointed = false,
  onShowWords,
}: {
  thread: PlanCommentThread;
  open: boolean;
  place: ThreadPlace;
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
  // Whether a press on the card at rest opened it, which is what hands its reply the caret; a thread open from the first, as every one in the Comments tab, takes none.
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!open) setPressed(false);
  }, [open]);
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
    return (
      <CommentCard
        place={place}
        open={false}
        hover={CARD_HOVER.WASH}
        lit={pointed}
        data-pointed={pointed}
        data-thread={thread.id}
      >
        {head}
        {/* Note that the words are drawn as they are open, their chips with them, clamped; the card's press opens the thread. */}
        {first === undefined ? null : (
          <WrittenComment writer={first.writer} agents={doors.agents} at={first.at} now={now}>
            <div className="comment-clamp">
              <CommentWords words={first.words ?? ""} />
            </div>
          </WrittenComment>
        )}
        {/* Note that the whole card at rest is one press that opens it, but for a control of its own inside it, an agent's name say, and a mention's chip opens it as it takes its own press; its button is the keyboard's way in, the replies drawn on it, or its name alone where there are none. */}
        <CardPress
          reach={CARD_PRESS_REACH.CARD}
          alsoPressedBy={MENTION_REF}
          corner={CARD_PRESS_CORNER.MENU}
          onPress={() => {
            setPressed(true);
            onOpen?.();
          }}
        >
          {replies.length === 0 ? (
            <VisuallyHidden>{COMMENT_WORDS.OPEN_THREAD}</VisuallyHidden>
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
                <Time at={replies.at(-1)?.at ?? thread.updatedAt} now={now} />
              </span>
            </span>
          )}
        </CardPress>
      </CommentCard>
    );
  }
  return (
    <CommentCard place={place} open data-thread={thread.id}>
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
      {thread.status === PLAN_COMMENT_STATUS.OPEN ? (
        <ReplyField
          label={COMMENT_WORDS.REPLY}
          place={{
            kind: DRAFT_PLACE.PLAN_COMMENT,
            planId: doors.control.planId,
            on: { threadId: thread.id },
          }}
          writer={doors.me}
          sending={sending}
          autoFocus={pressed}
          failure={note}
          onCancel={() => onClose?.()}
          onSend={async (words, clientKey, attachments) => {
            setSending(true);
            const sent = await doors.control.act(thread.id, {
              action: PLAN_COMMENT_ACTION.REPLY,
              clientKey,
              words,
              // Note that a reply with no files sends no key for them, so a service from before files reads it as it always did.
              ...(attachments.length === 0 ? undefined : { attachments }),
            });
            setSending(false);
            return sent;
          }}
        />
      ) : note === undefined ? null : (
        // Note that a resolved thread has no field to stand a failure under, so its Reopen's is said on its own.
        <FailureNote>{note}</FailureNote>
      )}
    </CommentCard>
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
    <CommentCard place={THREAD_PLACE.MARGIN} open data-thread={PENDING_THREAD}>
      <ReplyField
        label={COMMENT_WORDS.ADD}
        place={{
          kind: DRAFT_PLACE.PLAN_COMMENT,
          planId: doors.control.planId,
          on: { quote: pending.quote, scope: pending.scope },
        }}
        writer={doors.me}
        sending={sending}
        autoFocus
        failure={note}
        onCancel={onCancel}
        variant={REPLY_VARIANT.FIRST}
        onSend={async (words, clientKey, attachments) => {
          setSending(true);
          const started = await doors.control.start({
            clientKey,
            scope: pending.scope,
            quote: pending.quote,
            anchor: { from: pending.from, to: pending.to },
            // Note that words started on in the editor are measured in its text, which the service lays over the saved one.
            text: pending.text ?? text,
            words,
            ...(attachments.length === 0 ? undefined : { attachments }),
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
    </CommentCard>
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

/** Whether two measures stand every card at the same top. */
function sameTops(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...b].every(([id, top]) => a.get(id) === top);
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

/** The thread's cards are several boxes, which `KEEPS_THREAD_OPEN` names, so its press away stands by no layer of its own. */
const NO_LAYER: RefObject<HTMLElement | null> = { current: null };

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
  // Whether a pointer is down, whose press moves the focus before its own rule says what becomes of the thread.
  const pressing = useRef(false);
  // Whether the last press was a finger's, whose tap names the block its button stands by.
  const touching = useRef(false);
  const [bubble, setBubble] = useState<
    { top: number; left: number; below: boolean; start: () => void } | undefined
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
  // Note that the margin is measured again only when what it stands on
  // changes, or the plan's words or a card are resized, never on every draw,
  // because each measure lays the page out, a draw for every word typed among
  // it. A resize is measured once in the frame after it, however many land.
  const { threads } = doors.control;
  const [resized, setResized] = useState(0);
  // Whether the last measure found no body to measure in, as the first does, the body's ref being its ancestor's and attached after this layer's own effects.
  const unmeasured = useRef(false);
  useEffect(() => {
    const element = body.current;
    if (element === null) return;
    if (unmeasured.current) {
      unmeasured.current = false;
      setResized((count) => count + 1);
    }
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setResized((count) => count + 1);
      });
    });
    observer.observe(element);
    for (const card of cards.current.values()) observer.observe(card);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [body, threads, pending, wide]);
  useLayoutEffect(() => {
    unmeasured.current = body.current === null;
    const placed = [
      ...threads.filter(openThread).map((thread) => ({ id: thread.id, section: thread.section })),
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
    setTops((held) => (sameTops(held, next) ? held : next));
    const nextAnchors = new Map(placed.map((card) => [card.id, card.top]));
    setAnchors((held) => (sameTops(held, nextAnchors) ? held : nextAnchors));
  }, [threads, pending, active, anchorTop, text, wide, resized]);

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

  // A block under the pointer, or the one a finger last tapped, shows its button at the column's end; words selected raise the bubble over them.
  useEffect(() => {
    const element = body.current;
    if (element === null) return;
    const point = (target: EventTarget | null) => {
      const marked =
        target instanceof Element
          ? target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`)
          : null;
      setPointed(marked?.dataset.threads?.split(" ")[0]);
      const found = blockAt(target, unitClass);
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
    // Note that a finger's arrival names no block, because iOS plays a tap's
    // arrival as a hover and spends the tap on a button that comes in with
    // it, a link's in the block among them; its tap names the block once
    // the tap has gone where it leads.
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "touch") point(event.target);
    };
    const tapped = (event: MouseEvent) => {
      if (touching.current) point(event.target);
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
      if (next instanceof Element && next.closest(THREAD_ITSELF) !== null) {
        caretOpened.current = false;
        return;
      }
      // Note that a press on a control, a line's count say, focuses it before its click, and the press's own rule, the count's toggle say, settles the thread.
      if (pressing.current) return;
      // Note that the focus staying is the editor's room holding it, not the plan's body, whose title and buttons are Tab stops of their own.
      const room = element.querySelector(`.${EDITOR_ROOM_CLASS}`);
      if (next instanceof Node && room?.contains(next) === true) return;
      letCaretGo();
    };
    const selected = () => {
      // Note that a plan kept mounted under a hidden tab keeps its selection, but its words are no longer on screen to comment on.
      if (element.closest("[hidden]") !== null) {
        setBubble(undefined);
        return;
      }
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        if (editor !== undefined && selection?.isCollapsed === true) caretIn(selection);
        setBubble(undefined);
        return;
      }
      // Note that in the editor the format toolbar over the words starts their thread, so no bubble stands beside it.
      if (editor !== undefined) {
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
      // Note that a finger's bubble stands under the words, because the system's own selection menu stands over them, unless the window ends first.
      const below =
        coarsePointerNow() && box.bottom + BUBBLE_ROOM_TOUCH <= visibleViewport().bottom;
      const top = (below ? box.bottom : box.top) - own.top;
      const index = [...element.querySelectorAll(`.${unitClass}`)].indexOf(start);
      const section = sections[index];
      const quote = selection.toString().trim();
      if (section === undefined || quote === "") return;
      const from = drawnOffset(start, range.startContainer, range.startOffset);
      const to = drawnOffset(start, range.endContainer, range.endOffset);
      setBubble({
        top,
        left: box.left - own.left,
        below,
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
    const down = (event: PointerEvent) => {
      pressing.current = true;
      touching.current = event.pointerType === "touch";
    };
    const up = () => {
      pressing.current = false;
    };
    element.addEventListener("pointerover", over);
    element.addEventListener("click", tapped);
    element.addEventListener("pointerleave", left);
    element.addEventListener("focusout", blurred);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    // Note that a key pressed ends any press whose pointerup the window missed, so the Tab after it is the keyboard's.
    document.addEventListener("keydown", up, true);
    // Note that in the editor a press places the caret, so marked words there open no thread.
    if (editor === undefined) element.addEventListener("click", pressed);
    document.addEventListener("selectionchange", selected);
    // Note that hiding the tab the plan stands in changes no selection, so its `hidden` attribute is watched for itself.
    // Note that the tab shown again offers the words still selected there, though only a selection, not a caret, is read again, since a caret read opens and closes threads.
    const hiding = new MutationObserver(() => {
      if (element.closest("[hidden]") !== null || window.getSelection()?.isCollapsed === false) {
        selected();
      }
    });
    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    return () => {
      hiding.disconnect();
      element.removeEventListener("pointerover", over);
      element.removeEventListener("click", tapped);
      element.removeEventListener("pointerleave", left);
      element.removeEventListener("focusout", blurred);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", up, true);
      element.removeEventListener("click", pressed);
      document.removeEventListener("selectionchange", selected);
    };
  }, [body, editor, sections, unitClass, setPending, onActive, active]);

  // While the bubble stands, its command starts the thread as a press on it does.
  useAppCommand(APP_COMMAND.COMMENT_ON_SELECTION, bubble?.start);

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
  // A press anywhere but the thread, its words, or what it opened over the page closes it, its words kept as its draft; a thread being started goes too, but while its words are sent or it holds files or a dictation, which no draft keeps.
  usePressAway(NO_LAYER, () => undefined, {
    onPressAway:
      active === undefined
        ? undefined
        : () => {
            if (
              active === PENDING_THREAD &&
              cards.current.get(PENDING_THREAD)?.querySelector('[data-held="true"]')
            ) {
              return;
            }
            if (active === PENDING_THREAD) setPending(undefined);
            onActive(undefined);
          },
    holds: (target) => target instanceof Element && target.closest(KEEPS_THREAD_OPEN) !== null,
  });
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
      <MenuSurface
        flow={MENU_SURFACE_FLOW.TOOLBAR}
        className="comment-bubble"
        data-below={bubble.below ? "" : undefined}
        style={{ top: bubble.top, left: bubble.left }}
      >
        <Tooltip label={COMMENT_WORDS.COMMENT} command={APP_COMMAND.COMMENT_ON_SELECTION}>
          <Button keepFocus icon={<MessageSquarePlusIcon />} onClick={bubble.start}>
            {COMMENT_WORDS.COMMENT}
          </Button>
        </Tooltip>
      </MenuSurface>
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
                place={THREAD_PLACE.MARGIN}
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
              place={THREAD_PLACE.FLOAT}
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

/**
 * Starts a thread on the words selected in the open editor, measured through
 * it and its selection left as it stands, as the format toolbar's Comment
 * over them does; nothing where none are selected.
 */
export function useEditorComment(editor: RefObject<PlanEditorHandle | undefined>): () => void {
  const setPending = useContext(PendingSetter);
  return () => {
    const span = editor.current?.selectionSpan();
    if (span !== undefined) setPending(editorPending(span, PLAN_COMMENT_SCOPE.WORDS));
  };
}

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

/** The Comments tab's filter, kept on this Mac, one for every plan. */
const KEPT = {
  FILTER: keptKey<CommentsFilter>(
    "luke.commentsFilter",
    Schema.fromJsonString(Schema.Literals(Object.values(COMMENTS_FILTER))),
  ),
} as const;

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

/** The widths of each stand-in card's author line and its words, while the threads are read. */
const COMMENTS_SKELETON = [
  { author: "30%", words: ["100%", "70%"] },
  { author: "24%", words: ["100%", "85%", "40%"] },
  { author: "34%", words: ["90%"] },
] as const;

/** The threads as quiet cards while they are read, in a card's own type. */
function CommentsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the comments…">
      {COMMENTS_SKELETON.map((card) => (
        <CommentsRow key={card.author}>
          <CommentCard place={THREAD_PLACE.LIST} open={false}>
            <Skeleton width={card.author} />
            {card.words.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </CommentCard>
        </CommentsRow>
      ))}
    </SkeletonRegion>
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
  const [filter, setFilter] = useKept(KEPT.FILTER, COMMENTS_FILTER.OPEN);
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
    <Fill className="comments-tab">
      <WordsDatePickerRoom>
        <PaneBar
          title={COMMENTS_FILTER_WORDS[filter]}
          detail={listed.length}
          actions={
            <ResolvedOnly
              shown={filter === COMMENTS_FILTER.RESOLVED}
              onShown={(shown) => {
                setFilter(shown ? COMMENTS_FILTER.RESOLVED : COMMENTS_FILTER.OPEN);
                // Note that the other list starts at its top, not where the one it replaces was scrolled to.
                if (list.current !== null) list.current.scrollTop = 0;
              }}
            />
          }
        />
        <ScrollArea ref={list} fade={SCROLL_FADE.BOTH}>
          <div
            className="comments-list"
            data-empty={!control.failed && listed.length === 0 && control.read ? "" : undefined}
          >
            {control.failed ? (
              <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={control.onRetry}>
                The comments could not be read.
              </ErrorState>
            ) : listed.length === 0 ? (
              control.read ? (
                <EmptyState icon={<CommentsIcon />} title={NO_COMMENTS[filter].title}>
                  {NO_COMMENTS[filter].line}
                </EmptyState>
              ) : (
                <CommentsSkeleton />
              )
            ) : (
              listed.map((thread) => (
                <CommentsRow key={thread.id}>
                  {/* Note that every thread stands whole here, its replies and its field, its quote the way to its words in the plan. */}
                  <ThreadCard
                    thread={thread}
                    open
                    place={THREAD_PLACE.LIST}
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
                </CommentsRow>
              ))
            )}
          </div>
        </ScrollArea>
      </WordsDatePickerRoom>
    </Fill>
  );
}
