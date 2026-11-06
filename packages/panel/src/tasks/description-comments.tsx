import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AGENT_BOUNDS, type AgentAttachment, base64Bytes } from "@repo/features/agent-wire";
import { textChange } from "@repo/features/description-comment-anchor";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentStart,
  type DescriptionCommentThread,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import type { DescriptionSection } from "@repo/features/description-document";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { FrameBox, PagePicked } from "@repo/features/page-pick";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS, pasteCutWords } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
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
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  COMMENT_PIN_LOOK,
  COMMENT_PIN_STANDS,
  COMPOSER_LOOK,
  CONFIRM_LOSS,
  Comment,
  type CommentAuthor,
  CommentPin,
  type CommentPinStands,
  CommentsIcon,
  ComposerBody,
  ComposerFoot,
  ComposerFrame,
  ConfirmDialog,
  cssCustomProperties,
  type DialogQuestion,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FailureNote,
  Fill,
  HoverCard,
  IconButton,
  LINE_BUTTON_LOOK,
  LineButton,
  MENU_SURFACE_FLOW,
  MenuSurface,
  MoreButton,
  moreLabel,
  PaneBar,
  POPOVER_SIDE,
  QuietWords,
  RectFloat,
  SCROLL_FADE,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
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
} from "@repo/ui";
import { type Actor, APP_ACTOR } from "@repo/ui/actor-model";
import { neverBusyAct } from "@repo/ui/confirm-state";
import {
  type DescriptionCommentsControl,
  hungTop,
  type MarginView,
  marginTops,
  openThread,
  PENDING_THREAD,
  type PendingThread,
  useDescriptionCommentsControl as useDescriptionCommentsControlOrUndefined,
} from "@repo/ui/description-comments";
import {
  CheckIcon,
  CircleCheckIcon,
  GLYPH,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
} from "@repo/ui/icons";
import { MESSAGE_BLOCK, messageBlocks, messageText, replyOf } from "@repo/ui/reply-quote";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { ReplayUnmask, writeWithheldSheet } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { VIRTUAL_ROWS_ANCHOR, VirtualRows, type VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { visibleViewport } from "@repo/ui/visible-viewport";
import { Equal } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  createContext,
  Fragment,
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
  type DescriptionCommentPlace,
  DRAFT_PLACE,
  type DraftPlace,
  EMPTY_DRAFT,
  heldLines,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type DescriptionEditorHandle,
  type DescriptionEditorModule,
  type EditorSpan,
} from "../description-editor/contract.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { enterSubmitKey } from "../enter-sends.js";
import { confirmFailure, failureShown, unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { MarkdownMessage } from "../markdown-message.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { centerWithin } from "../scroll-within.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { CommentFiles } from "./description-comment-files.js";
import { EDITOR_ROOM_CLASS } from "./description-document-editor.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import type { EditAgents } from "./edit-ref.js";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { holderTaskId } from "./mention-holder.js";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker.js";
import { type HeldComment, PAGE_REVIEW_WORDS, type PageReviewControl } from "./page-review.js";
import { ComposerQuoteView, pressPlace, ReplyPress } from "./reply-to-selection.js";
import { type TaskMentionsValue, useMentionLink, useTaskMentions } from "./task-mentions.js";
import { DICTATION_PHASE, type DictationControl, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";
import { useNumberedTaskIdOf } from "./use-link-standing.js";
import { useOpenLink } from "./use-open-link.js";
import {
  useWordsDatePicker,
  WordsDatePickerRoom,
  type WordsDates,
  WordsDatesContext,
  wordsDatesDoor,
} from "./words-dates.js";

const QUOTE_CLASS =
  "comment-quote mx-0 mt-0 mb-control-gap line-clamp-2 border-l-2 border-l-comment-mark-edge pl-row-inset text-label font-text text-muted-foreground data-[gone=true]:border-l-border-strong data-[gone=true]:line-through data-[gone=true]:decoration-quote-strike";

const SLOT_CLASS =
  "comment-slot absolute inset-x-0 top-0 data-[moves=true]:transition-transform data-[moves=true]:duration-(--ui-duration-shape)";

const FLOW_SLOT_CLASS = "comment-slot";

interface MarginCard {
  readonly id: string;
  readonly thread: DescriptionCommentThread | undefined;
  readonly pending: PendingThread | undefined;
  readonly top: number;
  readonly open: boolean;
}

interface DrawnCard extends MarginCard {
  readonly leaving: boolean;
}

function sameCards(a: readonly MarginCard[], b: readonly MarginCard[]): boolean {
  return (
    a.length === b.length &&
    a.every((card, at) => {
      const other = b[at];
      return (
        other !== undefined &&
        card.id === other.id &&
        card.thread === other.thread &&
        card.pending === other.pending &&
        card.top === other.top &&
        card.open === other.open
      );
    })
  );
}

function useMarginCards(
  cards: readonly MarginCard[],
  drawing: boolean,
): {
  drawn: readonly DrawnCard[];
  gone: (id: string) => void;
} {
  const [held, setHeld] = useState<{
    last: readonly MarginCard[];
    leaving: readonly MarginCard[];
  }>(() => ({ last: cards, leaving: [] }));
  let { leaving } = held;
  if (!sameCards(held.last, cards) || (!drawing && leaving.length > 0)) {
    const standing = new Set(cards.map((card) => card.id));
    const left = held.last.filter((card) => !standing.has(card.id));
    leaving = drawing ? [...leaving.filter((card) => !standing.has(card.id)), ...left] : [];
    setHeld({ last: cards, leaving });
  }
  const gone = useCallback((id: string) => {
    setHeld((now) => ({ last: now.last, leaving: now.leaving.filter((card) => card.id !== id) }));
  }, []);
  return {
    drawn: [
      ...cards.map((card) => ({ ...card, leaving: false })),
      ...leaving.map((card) => ({ ...card, leaving: true })),
    ],
    gone,
  };
}

function MarginSlot({
  card,
  moves,
  slotRef,
  onGone,
  flows = false,
  children,
}: {
  card: DrawnCard;
  moves: boolean;
  slotRef: (element: HTMLDivElement | null) => void;
  onGone: (id: string) => void;
  flows?: boolean;
  children: ReactNode;
}): React.JSX.Element | null {
  const shown = useDisclosure(!card.leaving);
  const { id } = card;
  useEffect(() => {
    if (!shown.mounted) onGone(id);
  }, [shown.mounted, onGone, id]);
  if (!shown.mounted) return null;
  return (
    <div
      ref={(element) => {
        shown.ref(element);
        slotRef(card.leaving ? null : element);
      }}
      className={flows ? FLOW_SLOT_CLASS : SLOT_CLASS}
      data-moves={moves && !card.leaving}
      data-leaving={card.leaving ? "true" : undefined}
      inert={card.leaving}
      style={flows ? undefined : { transform: `translateY(${card.top}px)` }}
    >
      {children}
    </div>
  );
}

const MARGIN_ROOM = 48 + 288;

const READING_WIDTH = 720;

const COMMENT_MARK_CLASS = "description-comment-mark";

const REVEAL_ROOM = 96;

const MENTION_REF = "[data-mention-ref]";

const CARD_GAP = 8;

const HUNG_DROP = 28;

const VIEW_EDGE = 16;

const THREAD_PLACE = {
  MARGIN: "margin",
  FLOAT: "float",
  LIST: "list",
} as const;

type ThreadPlace = (typeof THREAD_PLACE)[keyof typeof THREAD_PLACE];

const BUBBLE_ROOM_TOUCH = FINGER_SELECTION_GAP + 48;

const COMMENT_WORDS = {
  COMMENT: "Comment",
  ADD: "Add a comment",
  REPLY: "Reply",
  RESOLVE: "Resolve",
  REOPEN: "Reopen",
  THING: "Comment",
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
  SHOW_WORDS: "Show in the description",
  SHOW_ELEMENT: "Show on the page",
  WHOLE_PAGE: "Whole page",
  DISCARD: "Discard",
  NOT_SENT: "This comment could not be sent.",
  NOT_SENT_MANY: "These comments could not be sent.",
  YOU: "You",
} as const;

interface CommentFocus {
  readonly active: string | undefined;
  readonly onActive: (thread: string | undefined) => void;
  readonly pending: PendingThread | undefined;
  readonly reveal: (thread: string) => void;
  readonly revealed: { readonly thread: string; readonly ask: number } | undefined;
  readonly listing: CommentsFilter | undefined;
  readonly onListing: (listing: CommentsFilter | undefined) => void;
}

const CommentFocusContext = createContext<CommentFocus>({
  active: undefined,
  onActive: () => undefined,
  pending: undefined,
  reveal: () => undefined,
  revealed: undefined,
  listing: undefined,
  onListing: () => undefined,
});

export function useCommentFocus(): CommentFocus {
  return useContext(CommentFocusContext);
}

function writerSubject(
  agents: EditAgents,
  agentId: string,
): { subject: AgentSubject; elsewhere: boolean } {
  const line = agents.control.listed?.find((each) => each.id === agentId);
  const subject = agentSubject(agents.control, agentId, NOTHING_HELD, false, line);
  return { subject, elsewhere: subject.agent === undefined && line !== undefined };
}

function useWriter(
  writer: DescriptionCommentWriter,
  agents: EditAgents | undefined,
): { author: CommentAuthor; nameRef: ReactNode } {
  const person = usePerson(writer.by);
  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) {
    return { author: commentAuthor(APP_ACTOR), nameRef: <ActorRef actor={APP_ACTOR} nameOnly /> };
  }
  if (
    writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    const { agentId } = writer;
    const { subject, elsewhere } = writerSubject(agents, agentId);
    return {
      author: commentAuthor(subject.tile),
      nameRef: (
        <AgentActorRef
          subject={subject}
          models={agents.control.models}
          onOpen={elsewhere ? undefined : () => agents.onOpen?.(agentId)}
          nameOnly
        />
      ),
    };
  }
  return { author: commentAuthor(person), nameRef: <ActorRef actor={person} nameOnly /> };
}

function WrittenComment({
  writer,
  agents,
  said,
  at,
  now,
  trailing,
  children,
}: {
  writer: DescriptionCommentWriter;
  agents: EditAgents | undefined;
  said?: string;
  at: number;
  now: number;
  trailing?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const { author, nameRef } = useWriter(writer, agents);
  return (
    <Comment author={author} nameRef={nameRef} said={said} at={at} now={now} trailing={trailing}>
      {children}
    </Comment>
  );
}

function WriterMark({
  writer,
  agents,
}: {
  writer: DescriptionCommentWriter;
  agents: EditAgents | undefined;
}): ReactNode {
  const person = usePerson(writer.by);
  let actor: Actor = person;
  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) actor = APP_ACTOR;
  else if (
    writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    actor = writerSubject(agents, writer.agentId).subject.tile;
  }
  return <ActorMark actor={actor} />;
}

function writtenByReader(entry: DescriptionCommentEntry, me: string | undefined): boolean {
  return (
    entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER &&
    me !== undefined &&
    entry.writer.by?.userId === me
  );
}

function EventLine({
  entry,
  agents,
  now,
}: {
  entry: DescriptionCommentEntry;
  agents: EditAgents | undefined;
  now: number;
}): React.JSX.Element {
  return (
    <div className="comment-event py-tight-gap" data-kind={entry.kind}>
      <WrittenComment
        writer={entry.writer}
        agents={agents}
        said={
          entry.kind === DESCRIPTION_COMMENT_ENTRY.RESOLVED
            ? COMMENT_WORDS.RESOLVED_IT
            : COMMENT_WORDS.REOPENED_IT
        }
        at={entry.at}
        now={now}
      />
    </div>
  );
}

interface ThreadDoors {
  readonly control: DescriptionCommentsControl;
  readonly agents: EditAgents | undefined;
  readonly me: string | undefined;
}

const DELETE_QUESTION: DialogQuestion = {
  title: "Delete this comment?",
  body: `The comment is deleted for everyone. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete comment",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const DELETE_THREAD_QUESTION: DialogQuestion = {
  title: "Delete this thread?",
  body: `Every comment in it is deleted with it. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete thread",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard this comment?",
  body: `Its words and files are kept nowhere else. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard comment",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const DISCARD_MANY_QUESTION: DialogQuestion = {
  title: "Discard these comments?",
  body: `Their words and files are kept nowhere else. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard comments",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

function CommentEntry({
  thread,
  entry,
  first,
  doors,
  now,
  lead,
}: {
  thread: DescriptionCommentThread;
  entry: DescriptionCommentEntry;
  first: boolean;
  doors: ThreadDoors;
  now: number;
  lead?: ReactNode;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const edited = useDraft({
    kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
    planId: doors.control.planId,
    on: { threadId: thread.id, entryId: entry.id },
  });
  const drafts = useDraftWriter();
  const deleting = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    neverBusyAct(() => {
      void doors.control
        .act(
          thread.id,
          first
            ? { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD }
            : { action: DESCRIPTION_COMMENT_ACTION.DELETE, entry: entry.id },
        )
        .then((deleted) => {
          if (deleted)
            drafts.drop((place) => writtenOn(place, thread.id, first ? undefined : entry.id));
        });
    }),
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DELETE),
  );
  const copyLink = useCopyLinkItem()({
    kind: LINK_PLACE.COMMENT,
    planId: doors.control.planId,
    threadId: thread.id,
  });
  const menu = useMenu(true);
  const trigger = menu.trigger();
  const mine = writtenByReader(entry, doors.me);
  const copies: MenuAction[] = copyLink === undefined ? [] : [copyLink];
  const edits: MenuAction[] = mine
    ? [
        {
          label: COMMENT_WORDS.EDIT,
          icon: <GLYPH.RENAME />,
          onSelect: () =>
            setEditing(edited.draft.text === "" ? (entry.words ?? "") : edited.draft.text),
        },
      ]
    : [];
  const deletes: MenuAction[] = [
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
    ...(first && (mine || entry.writer.actor !== DESCRIPTION_COMMENT_ACTOR.MEMBER)
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
  const groups = [copies, edits, deletes].filter((group) => group.length > 0);
  const settle = first && openThread(thread);
  const settleThread = () =>
    void doors.control.act(thread.id, {
      action: settle ? DESCRIPTION_COMMENT_ACTION.RESOLVE : DESCRIPTION_COMMENT_ACTION.REOPEN,
    });
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
              if (words.trim() === "") return;
              void control.act(thread.id, {
                action: DESCRIPTION_COMMENT_ACTION.EDIT,
                entry: entry.id,
                words: words.trim(),
              });
            },
          ),
    [mine, openDate, control, thread.id, entry.id],
  );
  const write = (words: string) => {
    setEditing(words);
    edited.update((was) => ({
      ...was,
      text: words.trim() === "" || words === entry.words ? "" : words,
    }));
  };
  const save = () => {
    const words = editing?.trim() ?? "";
    if (words === "") {
      deleting.ask();
      return;
    }
    setEditing(undefined);
    edited.update(() => EMPTY_DRAFT);
    void doors.control.act(thread.id, {
      action: DESCRIPTION_COMMENT_ACTION.EDIT,
      entry: entry.id,
      words,
    });
  };
  return (
    <div className="comment-entry relative py-tight-gap" data-entry={entry.id}>
      <WrittenComment
        writer={entry.writer}
        agents={doors.agents}
        at={entry.at}
        now={now}
        trailing={
          <>
            {entry.editedAt === undefined ? null : (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                <ReplayUnmask>{COMMENT_WORDS.EDITED}</ReplayUnmask>
              </Text>
            )}
            <div className="comment-tools">
              {first ? (
                <Tooltip label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}>
                  <IconButton
                    size={BUTTON_SIZE.COMPACT}
                    icon={settle ? <CheckIcon /> : <RotateCcwIcon />}
                    label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}
                    busy={false}
                    onClick={settleThread}
                  />
                </Tooltip>
              ) : null}
              {groups.length === 0 ? null : (
                <MoreButton thing={COMMENT_WORDS.THING} size={BUTTON_SIZE.COMPACT} {...trigger} />
              )}
              {groups.length === 0 || menu.drawn === undefined ? null : (
                <ActionMenu
                  replayUnmasked
                  label={moreLabel(COMMENT_WORDS.THING)}
                  menu={menu.drawn}
                  groups={groups}
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
              <Button onClick={() => setEditing(undefined)}>
                <ReplayUnmask>{COMMENT_WORDS.CANCEL}</ReplayUnmask>
              </Button>
              <Button variant={BUTTON_VARIANT.PRIMARY} busy={false} onClick={save}>
                <ReplayUnmask>{COMMENT_WORDS.SAVE}</ReplayUnmask>
              </Button>
            </div>
          </ComposerFrame>
        )}
      </WrittenComment>
    </div>
  );
}

function CommentWords({ words }: { words: string }): React.JSX.Element {
  const link = useMentionLink();
  const openLink = useOpenLink();
  return (
    <MarkdownMessage
      words={words}
      className="comment-words block text-body-foreground wrap-anywhere"
      link={link}
      openLink={openLink}
    />
  );
}

function CommentText(props: CommentTextProps): React.JSX.Element {
  const field = useCommentEditor();
  if (field === undefined) return <PlainCommentText {...props} />;
  return <MentionCommentText {...props} module={field.module} mentions={field.mentions} />;
}

function useCommentEditor():
  | { readonly module: DescriptionEditorModule | undefined; readonly mentions: TaskMentionsValue }
  | undefined {
  const bundle = useAtomValue(useSideBundles().descriptionEditor);
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
  readonly editor?: RefObject<ComposerEditorHandle | undefined> | undefined;
  readonly dictation?: DictationControl | undefined;
  readonly onPasteFiles?: ((files: readonly File[]) => boolean) | undefined;
  readonly onPasteCut?: (() => void) | undefined;
}

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
  module: DescriptionEditorModule | undefined;
  mentions: TaskMentionsValue;
}): React.JSX.Element {
  const own = useRef<ComposerEditorHandle | undefined>(undefined);
  const editor = handed ?? own;
  const dictating = dictation !== undefined && dictation.phase !== DICTATION_PHASE.IDLE;
  const room = useRef<HTMLDivElement>(null);
  const known = useKnownNames();
  const taskIdOf = useNumberedTaskIdOf();
  const picker = useMentionPicker({
    source: mentions,
    room,
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
      maxLength={DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS}
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
      quote={(quote) => <ComposerQuoteView quote={quote} held={dictating} />}
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
            taskIdOf,
            taskId: holderTaskId(mentions.holder),
            text: mentions.text,
          }),
      }}
      focus={autoFocus}
    >
      {picker.menu}
    </ComposerField>
  );
}

const NO_SKILLS: ReadonlySet<string> = new Set();

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
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0 && onPasteFiles?.(files) === true) event.preventDefault();
      }}
      submitKey={enterSubmitKey()}
      onSubmit={onSubmit}
      onEscape={onCancel}
    />
  );
}

interface CommentReview {
  readonly open: boolean;
  readonly onHold: (words: string, attachments: readonly AgentAttachment[]) => void;
}

function ReplyField({
  label,
  place,
  onSend,
  onCancel,
  autoFocus,
  failure,
  variant = REPLY_VARIANT.REPLY,
  review,
}: {
  label: string;
  place: DescriptionCommentPlace;
  onSend: (
    words: string,
    clientKey: string,
    attachments: readonly AgentAttachment[],
  ) => Promise<boolean>;
  onCancel: () => void;
  autoFocus: boolean;
  failure?: string | undefined;
  variant?: ReplyVariant;
  review?: CommentReview | undefined;
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const [heard, setHeard] = useState<string | undefined>(undefined);
  const dictation = useDictation({ editor, keywords: NO_KEYWORDS, onNote: setHeard });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const dictates = useCommentEditor() !== undefined;
  const { draft, update } = useDraft(place);
  const words = draft.text;
  const [cut, setCut] = useState(false);
  const setWords = (text: string) => {
    setCut(false);
    update((was) => ({ ...was, text }));
  };
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const files = useAttachedFiles({ onRefusal: setRefusal });
  const attempt = useRef<CommentSend | undefined>(undefined);
  const lines = useAtomValue(unsentAtom);
  const unsent = lines.filter((each) => Equal.equals(each.place, place)).map(({ send }) => send);
  const keepUnsent = useAtomSet(unsentAtom);
  const addUnsent = (sends: readonly CommentSend[]) =>
    keepUnsent((all) => [...all, ...sends.map((send) => ({ place, send }))]);
  const dropUnsent = () =>
    keepUnsent((all) => all.filter((each) => !Equal.equals(each.place, place)));
  const wordsNow = useRef(words);
  wordsNow.current = words;
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;
    return () => {
      standing.current = false;
    };
  }, []);
  const said =
    heard ?? (cut ? pasteCutWords(DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS) : undefined);
  const note = (unsent.length === 0 ? failure : undefined) ?? refusal ?? said;
  const takeBack = (sends: readonly CommentSend[]) => {
    const [first] = sends;
    if (first === undefined) return;
    attempt.current = first;
    const typed = wordsNow.current;
    const back = {
      words: typed.trim() === "" ? first.words : `${first.words}\n\n${typed}`,
      attachments: [...first.attachments, ...files.now()],
    };
    if (sends.length > 1 || !standing.current || !carried(back)) {
      addUnsent(sends);
      return;
    }
    update((now) => ({ ...now, text: back.words }));
    files.set(back.attachments);
  };
  const go = (out: CommentSend) => {
    void onSend(out.words, out.key, out.attachments).then((sent) => {
      if (!sent) takeBack([out]);
    });
  };
  const send = () => {
    const trimmed = words.trim();
    if (trimmed === "" || files.reading || unsent.length > 0) return;
    const { attachments } = files;
    const was = attempt.current;
    const same = was?.words === trimmed && sameFiles(was.attachments, attachments);
    attempt.current = undefined;
    setWords("");
    files.set([]);
    go({
      words: trimmed,
      attachments,
      key: same && was !== undefined ? was.key : crypto.randomUUID(),
    });
  };
  const hold = () => {
    const trimmed = words.trim();
    if (review === undefined || trimmed === "" || files.reading || unsent.length > 0) return;
    const { attachments } = files;
    attempt.current = undefined;
    setWords("");
    files.set([]);
    review.onHold(trimmed, attachments);
  };
  const holds = review?.open === true;
  const submit = holds ? hold : send;
  const other =
    review === undefined || holds ? undefined : (
      <Button
        size={BUTTON_SIZE.COMPACT}
        disabled={words.trim() === "" || files.reading || unsent.length > 0}
        onClick={hold}
      >
        <ReplayUnmask>{PAGE_REVIEW_WORDS.START}</ReplayUnmask>
      </Button>
    );
  const retry = () => {
    if (unsent.length === 0) return;
    dropUnsent();
    for (const each of unsent) go(each);
  };
  const discard = useConfirmDialog(
    { subject: unsent.length > 0, surfaceOpen: true },
    neverBusyAct(() => {
      dropUnsent();
      attempt.current = undefined;
    }),
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DISCARD),
  );
  return (
    <ComposerFrame
      look={variant === REPLY_VARIANT.FIRST ? COMPOSER_LOOK.BARE : COMPOSER_LOOK.CARD}
      className="comment-field"
      data-variant={variant}
      dropping={files.drop.dropping}
      data-held={files.attachments.length > 0 || files.reading || dictating}
      {...files.drop.target}
    >
      {unsent.length === 0 ? null : (
        <div className="comment-unsent" data-unsent="">
          {unsent.map((each) => (
            <Fragment key={each.key}>
              <AttachedFileChips files={attachmentChips(each.attachments)} />
              <CommentWords words={each.words} />
            </Fragment>
          ))}
          <FailureNote
            onRetry={retry}
            failure={failureShown({
              surface: FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
              cause: failure === undefined ? FAILURE_CONDITION.NOT_KEPT : FAILURE_CONDITION.REFUSED,
            })}
            also={
              <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={discard.ask}>
                <ReplayUnmask>{COMMENT_WORDS.DISCARD}</ReplayUnmask>
              </TextButton>
            }
          >
            {failure ?? (
              <ReplayUnmask>
                {unsent.length === 1 ? COMMENT_WORDS.NOT_SENT : COMMENT_WORDS.NOT_SENT_MANY}
              </ReplayUnmask>
            )}
          </FailureNote>
          <ConfirmDialog
            open
            confirm={discard}
            question={unsent.length === 1 ? DISCARD_QUESTION : DISCARD_MANY_QUESTION}
          />
        </div>
      )}
      <ComposerBody
        files={
          <AttachedFileChips files={attachmentChips(files.attachments)} onRemove={files.remove} />
        }
      >
        <CommentText
          value={words}
          label={label}
          onChange={setWords}
          onSubmit={submit}
          onCancel={onCancel}
          autoFocus={autoFocus}
          editor={editor}
          dictation={dictation}
          onPasteFiles={files.paste}
          onPasteCut={() => {
            setHeard(undefined);
            setCut(true);
          }}
        />
      </ComposerBody>
      <ComposerFoot
        tools={<AttachFilesButton onFiles={files.attach} />}
        counter={
          dictates
            ? { length: words.length, limit: DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS }
            : undefined
        }
        actions={
          dictates || other !== undefined ? (
            <>
              {other}
              {dictates ? <DictateButton dictation={dictation} disabled={false} /> : null}
            </>
          ) : undefined
        }
        strip={dictating ? <DictationStrip dictation={dictation} /> : undefined}
        send={{
          label: holds
            ? PAGE_REVIEW_WORDS.ADD
            : label === COMMENT_WORDS.ADD
              ? COMMENT_WORDS.COMMENT
              : COMMENT_WORDS.REPLY,
          empty: words.trim() === "",
          held: files.reading || unsent.length > 0,
          onSend: submit,
        }}
        note={
          note === undefined
            ? undefined
            : {
                words: note,
                failure:
                  note === refusal || (note === said && heard === undefined)
                    ? UNREPORTED.INPUT
                    : failureShown({
                        surface:
                          note === heard
                            ? FAILURE_SURFACE.DICTATION
                            : FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
                        cause: FAILURE_CONDITION.REFUSED,
                        refused: true,
                      }),
              }
        }
      />
    </ComposerFrame>
  );
}

function writtenOn(place: DraftPlace, threadId: string, entryId: string | undefined): boolean {
  if (place.kind !== DRAFT_PLACE.DESCRIPTION_COMMENT || !("threadId" in place.on)) return false;
  if (place.on.threadId !== threadId) return false;
  return entryId === undefined || ("entryId" in place.on && place.on.entryId === entryId);
}

interface CommentSend {
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly key: string;
}

const unsentAtom = heldLines<{
  readonly place: DescriptionCommentPlace;
  readonly send: CommentSend;
}>();

function carried(send: Pick<CommentSend, "words" | "attachments">): boolean {
  if (send.words.length > DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS) return false;
  if (send.attachments.length > AGENT_BOUNDS.MAX_ATTACHMENTS) return false;
  const bytes = send.attachments.reduce((sum, each) => sum + base64Bytes(each.data), 0);
  return bytes <= AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES;
}

function sameFiles(was: readonly AgentAttachment[], now: readonly AgentAttachment[]): boolean {
  return was.length === now.length && was.every((file, at) => file === now[at]);
}

const REPLY_VARIANT = { FIRST: "first", REPLY: "reply" } as const;

type ReplyVariant = (typeof REPLY_VARIANT)[keyof typeof REPLY_VARIANT];

const NO_KEYWORDS: readonly string[] = [];

function GoneQuote({
  thread,
  onShowWords,
}: {
  thread: DescriptionCommentThread;
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <div className="comment-gone">
        <TrashIcon />
        <ReplayUnmask>{COMMENT_WORDS.GONE}</ReplayUnmask>
      </div>
      <ThreadQuote thread={thread} gone onShowWords={onShowWords} />
    </>
  );
}

function quoteWords(thread: DescriptionCommentThread): string {
  if (thread.page === undefined) return thread.quote;
  return thread.page.element === undefined ? COMMENT_WORDS.WHOLE_PAGE : COMMENT_WORDS.SHOW_ELEMENT;
}

function ThreadQuote({
  thread,
  gone = false,
  onShowWords,
}: {
  thread: DescriptionCommentThread;
  gone?: boolean;
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  if (onShowWords === undefined) {
    return (
      <blockquote className={QUOTE_CLASS} data-gone={gone}>
        {quoteWords(thread)}
      </blockquote>
    );
  }
  return (
    <blockquote className={QUOTE_CLASS} data-gone={gone}>
      <Tooltip
        label={thread.page === undefined ? COMMENT_WORDS.SHOW_WORDS : COMMENT_WORDS.SHOW_ELEMENT}
      >
        <LineButton look={LINE_BUTTON_LOOK.QUOTE} onClick={onShowWords}>
          {quoteWords(thread)}
        </LineButton>
      </Tooltip>
    </blockquote>
  );
}

function threadFrame(place: ThreadPlace, open: boolean): { look: CardLook; shadow: CardShadow } {
  const raised = place === THREAD_PLACE.FLOAT || (open && place === THREAD_PLACE.MARGIN);
  return raised
    ? { look: CARD_LOOK.RAISED, shadow: CARD_SHADOW.MENU }
    : { look: CARD_LOOK.OUTLINE, shadow: CARD_SHADOW.NONE };
}

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
      className="comment-card px-list-inset py-row-inset text-body text-foreground data-[open=false]:cursor-press"
      data-open={String(open)}
      {...data}
    >
      {children}
    </Card>
  );
}

function CommentsRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="comments-row [.comments-row+&]:mt-control-gap">{children}</div>;
}

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
  thread: DescriptionCommentThread;
  open: boolean;
  place: ThreadPlace;
  doors: ThreadDoors;
  onOpen?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  quote?: boolean;
  pointed?: boolean;
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const comments = thread.entries.filter(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT,
  );
  const [first] = comments;
  const gone = thread.anchor === undefined && thread.page === undefined;
  const note = doors.control.notes.get(thread.id);
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
        {first === undefined ? null : (
          <WrittenComment writer={first.writer} agents={doors.agents} at={first.at} now={now}>
            <div className="comment-clamp line-clamp-3">
              <CommentWords words={first.words ?? ""} />
            </div>
          </WrittenComment>
        )}
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
            <VisuallyHidden>
              <ReplayUnmask>{COMMENT_WORDS.OPEN_THREAD}</ReplayUnmask>
            </VisuallyHidden>
          ) : (
            <span className="mt-list-gap mr-0 mb-0 ml-comment-indent flex items-center gap-item-gap text-caption-inline text-muted-foreground">
              <span className="inline-flex">
                {faces.map((writer) => (
                  <WriterMark key={JSON.stringify(writer)} writer={writer} agents={doors.agents} />
                ))}
              </span>
              <ReplayUnmask>
                {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
              </ReplayUnmask>
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
      <ScrollArea
        size={SCROLL_SIZE.CONTENT}
        fade={SCROLL_FADE.BOTH}
        overscroll={SCROLL_OVERSCROLL.CHAIN}
      >
        <div className="comment-entries">
          {first === undefined ? head : null}
          {thread.entries.map((entry) =>
            entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT ? (
              <CommentEntry
                key={entry.id}
                thread={thread}
                entry={entry}
                first={entry.id === first?.id}
                doors={doors}
                now={now}
                lead={entry.id === first?.id ? head : undefined}
              />
            ) : entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED ? null : (
              <EventLine key={entry.id} entry={entry} agents={doors.agents} now={now} />
            ),
          )}
        </div>
      </ScrollArea>
      {thread.status === DESCRIPTION_COMMENT_STATUS.OPEN ? (
        <ReplyField
          label={COMMENT_WORDS.REPLY}
          place={{
            kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
            planId: doors.control.planId,
            on: { threadId: thread.id },
          }}
          autoFocus={pressed}
          failure={note}
          onCancel={() => onClose?.()}
          onSend={(words, clientKey, attachments) =>
            doors.control.act(thread.id, {
              action: DESCRIPTION_COMMENT_ACTION.REPLY,
              clientKey,
              words,
              ...(attachments.length === 0 ? undefined : { attachments }),
            })
          }
        />
      ) : null}
    </CommentCard>
  );
}

interface FirstComment {
  readonly id: string;
  readonly clientKey: string;
  readonly words: string;
  readonly attachments?: readonly AgentAttachment[];
}

function PendingCard({
  on,
  place = THREAD_PLACE.MARGIN,
  head,
  doors,
  begin,
  onStarted,
  onCancel,
  review,
}: {
  on: { readonly quote: string; readonly scope: DescriptionCommentThread["scope"] };
  place?: ThreadPlace;
  head?: ReactNode;
  doors: ThreadDoors;
  begin: (first: FirstComment) => DescriptionCommentStart;
  onStarted: (threadId: string) => void;
  onCancel: () => void;
  review?: CommentReview | undefined;
}): React.JSX.Element {
  return (
    <CommentCard place={place} open data-thread={PENDING_THREAD}>
      {head}
      <ReplyField
        label={COMMENT_WORDS.ADD}
        place={{ kind: DRAFT_PLACE.DESCRIPTION_COMMENT, planId: doors.control.planId, on }}
        autoFocus
        onCancel={onCancel}
        variant={REPLY_VARIANT.FIRST}
        review={
          review === undefined
            ? undefined
            : {
                open: review.open,
                onHold: (words, attachments) => {
                  review.onHold(words, attachments);
                  onCancel();
                },
              }
        }
        onSend={(words, clientKey, attachments) => {
          const started = doors.control.start(
            begin({
              id: clientKey,
              clientKey,
              words,
              ...(attachments.length === 0 ? undefined : { attachments }),
            }),
          );
          onStarted(clientKey);
          return started.then((answer) => !("note" in answer));
        }}
      />
    </CommentCard>
  );
}

function descriptionBegin(
  pending: PendingThread,
  text: string,
): (first: FirstComment) => DescriptionCommentStart {
  return (first) => {
    const saved = pending.text === undefined ? pending : textChange(pending.text, text)(pending);
    return {
      ...first,
      scope: pending.scope,
      quote: pending.quote,
      ...(saved === undefined
        ? { anchor: { from: pending.from, to: pending.to }, text: pending.text ?? text }
        : { anchor: { from: saved.from, to: saved.to }, text }),
    };
  };
}

function drawnOffset(root: HTMLElement, node: globalThis.Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function ownWords(unit: HTMLElement, block: HTMLElement) {
  const from = drawnOffset(unit, block, 0);
  const quote = ownRange(block).toString().trimEnd();
  return { quote, from, to: from + quote.length };
}

function ownRange(block: HTMLElement): Range {
  const nested = [...block.childNodes].findIndex(
    (child) => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL"),
  );
  const range = document.createRange();
  range.selectNodeContents(block);
  if (nested >= 0) range.setEnd(block, nested);
  return range;
}

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

function editorPending(span: EditorSpan, scope: PendingThread["scope"]): PendingThread {
  return { ...span, scope, quote: span.quote.slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

function sourceSpan(
  unit: HTMLElement,
  section: DescriptionSection,
  drawn: { readonly from: number; readonly to: number },
): { readonly from: number; readonly to: number } | undefined {
  const span = textChange(unit.textContent ?? "", section.text)(drawn);
  return span === undefined
    ? undefined
    : { from: section.from + span.from, to: section.from + span.to };
}

function pendingOf(
  unit: HTMLElement,
  section: DescriptionSection,
  drawn: { readonly from: number; readonly to: number },
  scope: PendingThread["scope"],
  quote: string,
): PendingThread | undefined {
  const span = sourceSpan(unit, section, drawn);
  return span === undefined
    ? undefined
    : { ...span, scope, quote: quote.slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

function sameTops(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...b].every(([id, top]) => a.get(id) === top);
}

function topIn(body: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - body.getBoundingClientRect().top;
}

function lineMiddleIn(body: HTMLElement, element: Element): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, (node) =>
    (node.textContent ?? "").trim() === "" ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT,
  );
  const holder = walker.nextNode()?.parentElement ?? element;
  const style = getComputedStyle(holder);
  const line = style.display === "inline" ? holder.getClientRects()[0] : undefined;
  if (line !== undefined) return (line.top + line.bottom) / 2 - body.getBoundingClientRect().top;
  const height = Number.parseFloat(style.lineHeight);
  return topIn(body, holder) + (Number.isFinite(height) ? height / 2 : 0);
}

function viewIn(scroller: HTMLElement | null, body: HTMLElement | null): MarginView | undefined {
  if (scroller === null || body === null) return undefined;
  const at = topIn(body, scroller) + scroller.clientTop;
  return { top: at + VIEW_EDGE, bottom: at + scroller.clientHeight - VIEW_EDGE };
}

function blockAt(
  target: EventTarget | null,
  unitClass: string,
): { block: HTMLElement; unit: HTMLElement } | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const unit = target.closest<HTMLElement>(`.${unitClass}`);
  if (unit === null) return undefined;
  if (target.tagName === "UL" || target.tagName === "OL") return undefined;
  const item = target.closest<HTMLElement>("li");
  if (item !== null && unit.contains(item)) return { block: item, unit };
  let block: HTMLElement | null = target;
  while (block !== null && block.parentElement !== unit) block = block.parentElement;
  return block === null ? undefined : { block, unit };
}

let openThreadSheet: CSSStyleSheet | undefined;

function editorOpenThread(thread: string | undefined): void {
  if (!("CSSStyleSheet" in globalThis) || !("adoptedStyleSheets" in document)) return;
  if (openThreadSheet === undefined) {
    openThreadSheet = new CSSStyleSheet();
    writeWithheldSheet(openThreadSheet, "");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, openThreadSheet];
  }
  writeWithheldSheet(
    openThreadSheet,
    thread === undefined
      ? ""
      : `.description-document-text .${COMMENT_MARK_CLASS}[data-threads~="${thread}"] { padding-bottom: 1px; border-bottom: 1.5px solid var(--comment-mark-active-edge); background: var(--comment-mark-active); }`,
  );
}

const THREAD_ITSELF = '.comment-card, [role="menu"], [role="dialog"], [role="alertdialog"]';

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

const NO_LAYER: RefObject<HTMLElement | null> = { current: null };

export function DescriptionCommentLayer({
  body,
  scroller,
  shown: descriptionShown,
  unitClass,
  sections,
  text,
  doors,
  editor,
}: {
  body: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  shown: boolean;
  unitClass: string;
  sections: readonly DescriptionSection[];
  text: string;
  doors: ThreadDoors;
  editor: RefObject<DescriptionEditorHandle | undefined> | undefined;
}): React.JSX.Element | null {
  const { active, onActive, pending, revealed, listing, onListing } = useCommentFocus();
  const setPending = useContext(PendingSetter);
  const [wide, setWide] = useState(true);
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  const [hung, setHung] = useState<ReadonlyMap<string, number>>(new Map());
  const [cardRoom, setCardRoom] = useState<number | undefined>(undefined);
  const [anchors, setAnchors] = useState<ReadonlyMap<string, number>>(new Map());
  const [lines, setLines] = useState<ReadonlyMap<string, number>>(new Map());
  const [hovered, setHovered] = useState<
    { top: number; middle: number; start: () => void } | undefined
  >(undefined);
  const [pointed, setPointed] = useState<string | undefined>(undefined);
  const caretOpened = useRef(false);
  const pressing = useRef(false);
  const touching = useRef(false);
  const [bubble, setBubble] = useState<
    { top: number; left: number; below: boolean; start: () => void } | undefined
  >(undefined);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const settled = useRef(new Set<string>());
  const open = doors.control.threads
    .filter(openThread)
    .sort((one, other) => (anchors.get(one.id) ?? 0) - (anchors.get(other.id) ?? 0));
  const marginCards = useMarginCards(
    [
      ...open.map((thread) => ({
        id: thread.id,
        thread,
        pending: undefined,
        top: tops.get(thread.id) ?? 0,
        open: active === thread.id,
      })),
      ...(pending === undefined
        ? []
        : [
            {
              id: PENDING_THREAD,
              thread: undefined,
              pending,
              top: tops.get(PENDING_THREAD) ?? 0,
              open: true,
            },
          ]),
    ],
    wide,
  );

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => {
      setWide(element.clientWidth >= READING_WIDTH + 2 * MARGIN_ROOM);
      setCardRoom(Math.max(0, element.clientHeight - 2 * VIEW_EDGE));
      setResized((count) => count + 1);
    };
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

  const anchorOf = useCallback(
    (thread: string, section: string): Element | undefined => {
      const element = body.current;
      if (element === null) return undefined;
      const mark = element.querySelector(`.${COMMENT_MARK_CLASS}[data-threads~="${thread}"]`);
      if (mark !== null) return mark;
      const at = sections.findIndex((each) => each.heading === section);
      return (at < 0 ? undefined : element.querySelectorAll(`.${unitClass}`)[at]) ?? element;
    },
    [body, sections, unitClass],
  );
  const anchorAt = useCallback(
    (thread: string, section: string): { top: number; middle: number } | undefined => {
      const element = body.current;
      const anchor = anchorOf(thread, section);
      if (element === null || anchor === undefined) return undefined;
      return {
        top: anchor === element ? 0 : topIn(element, anchor),
        middle: lineMiddleIn(element, anchor),
      };
    },
    [body, anchorOf],
  );
  const { threads } = doors.control;
  const [resized, setResized] = useState(0);
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
  }, [body, threads, pending, wide, active]);
  useLayoutEffect(() => {
    unmeasured.current = body.current === null;
    const placed = [
      ...threads.filter(openThread).map((thread) => ({ id: thread.id, section: thread.section })),
      ...(pending === undefined ? [] : [{ id: PENDING_THREAD, section: "" }]),
    ].flatMap(({ id, section }) => {
      const at = anchorAt(id, section);
      return at === undefined
        ? []
        : [{ id, ...at, height: cards.current.get(id)?.offsetHeight ?? 0 }];
    });
    const view = viewIn(scroller.current, body.current);
    const next = marginTops(
      placed,
      active ?? (pending === undefined ? undefined : PENDING_THREAD),
      CARD_GAP,
      view,
    );
    setTops((held) => (sameTops(held, next) ? held : next));
    const nextHung = new Map(
      placed.map((card) => [
        card.id,
        view === undefined
          ? card.top + HUNG_DROP
          : hungTop(card.top, HUNG_DROP, card.height, CARD_GAP, view),
      ]),
    );
    setHung((held) => (sameTops(held, nextHung) ? held : nextHung));
    const nextAnchors = new Map(placed.map((card) => [card.id, card.top]));
    setAnchors((held) => (sameTops(held, nextAnchors) ? held : nextAnchors));
    const nextLines = new Map(placed.map((card) => [card.id, card.middle]));
    setLines((held) => (sameTops(held, nextLines) ? held : nextLines));
  }, [threads, pending, active, anchorAt, text, wide, resized]);

  const scrolled = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scroller.current;
    const room = body.current;
    if (revealed === undefined || element === null || room === null) return;
    if (scrolled.current === revealed.ask) return;
    const asked = doors.control.threads.find((each) => each.id === revealed.thread);
    if (!doors.control.read || asked === undefined) return;
    if (!openThread(asked)) return;
    const at = anchorAt(asked.id, asked.section);
    if (at === undefined) return;
    scrolled.current = revealed.ask;
    element.scrollTop +=
      room.getBoundingClientRect().top + at.top - element.getBoundingClientRect().top - REVEAL_ROOM;
    setResized((count) => count + 1);
  });

  const listedAsk = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (revealed === undefined || listedAsk.current === revealed.ask) return;
    const asked = doors.control.threads.find((each) => each.id === revealed.thread);
    if (asked === undefined || openThread(asked)) return;
    listedAsk.current = revealed.ask;
    onListing(COMMENTS_FILTER.RESOLVED);
  }, [revealed, doors.control.threads, onListing]);
  useEffect(() => {
    if (pending !== undefined && listing !== undefined) onListing(undefined);
  }, [pending, listing, onListing]);
  const [listTop, setListTop] = useState(0);
  useLayoutEffect(() => {
    const room = body.current;
    const toggle = room?.querySelector(`.${COMMENTS_TOGGLE_CLASS}`);
    if (listing === undefined || room === null || room === undefined || toggle == null) return;
    const top = toggle.getBoundingClientRect().bottom - room.getBoundingClientRect().top + CARD_GAP;
    setListTop((held) => (Math.abs(held - top) < 1 ? held : top));
  });

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
      if (threadedWhole(found.block)) {
        setHovered(undefined);
        return;
      }
      if (editor !== undefined) {
        setHovered({
          top: topIn(element, found.block),
          middle: lineMiddleIn(element, found.block),
          start: () => {
            const span = editor.current?.blockSpan(found.block);
            if (span !== undefined)
              setPending(editorPending(span, DESCRIPTION_COMMENT_SCOPE.BLOCK));
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
        middle: lineMiddleIn(element, found.block),
        start: () => {
          const begun = pendingOf(
            found.unit,
            section,
            { from, to },
            DESCRIPTION_COMMENT_SCOPE.BLOCK,
            quote,
          );
          if (begun !== undefined) setPending(begun);
        },
      });
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "touch") point(event.target);
    };
    const tapped = (event: MouseEvent) => {
      if (touching.current) point(event.target);
    };
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
    const blurred = (event: FocusEvent) => {
      if (editor === undefined) return;
      const next = event.relatedTarget;
      if (next === null) return;
      if (next instanceof Element && next.closest(THREAD_ITSELF) !== null) {
        caretOpened.current = false;
        return;
      }
      if (pressing.current) return;
      const room = element.querySelector(`.${EDITOR_ROOM_CLASS}`);
      if (next instanceof Node && room?.contains(next) === true) return;
      letCaretGo();
    };
    const selected = () => {
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
          const begun = pendingOf(
            start,
            section,
            { from, to },
            DESCRIPTION_COMMENT_SCOPE.WORDS,
            quote,
          );
          if (begun !== undefined) setPending(begun);
          setBubble(undefined);
          selection.removeAllRanges();
        },
      });
    };
    const pressed = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const mark = event.target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`);
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
    document.addEventListener("keydown", up, true);
    if (editor === undefined) element.addEventListener("click", pressed);
    document.addEventListener("selectionchange", selected);
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

  useAppCommand(APP_COMMAND.COMMENT_ON_SELECTION, bubble?.start);

  const cardRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element === null) cards.current.delete(id);
    else cards.current.set(id, element);
  };
  useEffect(() => {
    settled.current = new Set(tops.keys());
  });
  const editorActive = editor !== undefined && active !== PENDING_THREAD ? active : undefined;
  useEffect(() => {
    editorOpenThread(editorActive);
    return () => editorOpenThread(undefined);
  }, [editorActive]);
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
  const close = () => {
    onActive(undefined);
    setPending(undefined);
  };
  const startedFromPending = (threadId: string) => {
    setPending(undefined);
    onActive(threadId);
  };
  const pendingCard =
    pending === undefined ? null : (
      <PendingCard
        on={pending}
        doors={doors}
        begin={descriptionBegin(pending, text)}
        onCancel={close}
        onStarted={startedFromPending}
      />
    );
  const blockButton =
    hovered === undefined ||
    (!wide && [...anchors.values()].some((top) => Math.abs(top - hovered.top) < 4)) ? null : (
      <div className="comment-block-button" style={{ top: hovered.middle }}>
        <Tooltip label={COMMENT_WORDS.COMMENT}>
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
        className="comment-bubble absolute z-3 -translate-y-[calc(100%+var(--ui-space-6))] data-below:translate-y-ui-16"
        data-below={bubble.below ? "" : undefined}
        style={{ top: bubble.top, left: bubble.left }}
      >
        <Tooltip label={COMMENT_WORDS.COMMENT} command={APP_COMMAND.COMMENT_ON_SELECTION}>
          <Button keepFocus icon={<MessageSquarePlusIcon />} onClick={bubble.start}>
            <ReplayUnmask>{COMMENT_WORDS.COMMENT}</ReplayUnmask>
          </Button>
        </Tooltip>
      </MenuSurface>
    );
  const layerStyle =
    cardRoom === undefined
      ? undefined
      : cssCustomProperties({ "--comment-card-room": `${cardRoom}px` });
  if (listing !== undefined) {
    return (
      <div className="comment-layer" style={layerStyle}>
        {blockButton}
        {bubbleDrawn}
        <DescriptionCommentList
          doors={doors}
          listing={listing}
          onListing={onListing}
          wide={wide}
          top={listTop}
          scroller={scroller}
          shown={descriptionShown}
        />
      </div>
    );
  }
  if (wide) {
    return (
      <div className="comment-layer" style={layerStyle}>
        {blockButton}
        {bubbleDrawn}
        <div className="comment-margin absolute top-0 left-comment-margin w-comment-card">
          {marginCards.drawn.map((card) => (
            <MarginSlot
              key={card.id}
              card={card}
              moves={settled.current.has(card.id)}
              slotRef={cardRef(card.id)}
              onGone={marginCards.gone}
            >
              {card.thread !== undefined ? (
                <ThreadCard
                  thread={card.thread}
                  open={card.open}
                  place={THREAD_PLACE.MARGIN}
                  doors={doors}
                  pointed={!card.leaving && pointed === card.id}
                  onOpen={() => {
                    setPending(undefined);
                    onActive(card.id);
                  }}
                  onClose={close}
                />
              ) : card.pending !== undefined ? (
                <PendingCard
                  on={card.pending}
                  doors={doors}
                  begin={descriptionBegin(card.pending, text)}
                  onCancel={close}
                  onStarted={startedFromPending}
                />
              ) : null}
            </MarginSlot>
          ))}
        </div>
      </div>
    );
  }
  const counts = new Map<number, DescriptionCommentThread[]>();
  for (const thread of open) {
    const top = anchors.get(thread.id);
    if (top === undefined) continue;
    counts.set(top, [...(counts.get(top) ?? []), thread]);
  }
  const shown = open.find((thread) => thread.id === active);
  const shownTop = shown === undefined ? undefined : anchors.get(shown.id);
  return (
    <div className="comment-layer" style={layerStyle}>
      {blockButton}
      {bubbleDrawn}
      {[...counts].map(([top, threads]) => {
        const comments = threads.reduce(
          (sum, thread) =>
            sum +
            thread.entries.filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT)
              .length,
          0,
        );
        const first = threads[0];
        const middle = first === undefined ? undefined : lines.get(first.id);
        return (
          <span key={top} className="comment-count" style={{ top: middle ?? top }}>
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
        <div
          className="comment-float"
          style={{ top: hung.get(shown.id) ?? shownTop + HUNG_DROP }}
          ref={cardRef(shown.id)}
        >
          <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
            <div className="comment-float-cards">
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
          </ScrollArea>
        </div>
      )}
      {pendingCard === null ? null : (
        <div
          className="comment-float"
          style={{
            top: hung.get(PENDING_THREAD) ?? (anchors.get(PENDING_THREAD) ?? 0) + HUNG_DROP,
          }}
          ref={cardRef(PENDING_THREAD)}
        >
          {pendingCard}
        </div>
      )}
    </div>
  );
}

const PendingSetter = createContext<(pending: PendingThread | undefined) => void>(() => undefined);

export function useEditorComment(
  editor: RefObject<DescriptionEditorHandle | undefined>,
): () => void {
  const setPending = useContext(PendingSetter);
  return () => {
    const span = editor.current?.selectionSpan();
    if (span !== undefined) setPending(editorPending(span, DESCRIPTION_COMMENT_SCOPE.WORDS));
  };
}

export function CommentFocusScope({
  planId,
  children,
  reveal,
}: {
  planId?: string | undefined;
  children: ReactNode;
  reveal?: { readonly thread: string; readonly ask: number } | undefined;
}): React.JSX.Element {
  const [active, setActive] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingThread | undefined>(undefined);
  const [revealed, setRevealed] = useState<CommentFocus["revealed"]>(undefined);
  const [listing, setListing] = useState<CommentsFilter | undefined>(undefined);
  const [focusedOn, setFocusedOn] = useState(planId);
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
      listing,
      onListing: setListing,
    }),
    [active, pending, onReveal, revealed, listing, focusedOn, planId],
  );
  return (
    <CommentFocusContext.Provider value={focus}>
      <PendingSetter.Provider value={setPending}>{children}</PendingSetter.Provider>
    </CommentFocusContext.Provider>
  );
}

export const COMMENTS_FILTER = { OPEN: "open", RESOLVED: "resolved" } as const;

export type CommentsFilter = (typeof COMMENTS_FILTER)[keyof typeof COMMENTS_FILTER];

const COMMENTS_FILTER_WORDS = {
  [COMMENTS_FILTER.OPEN]: "Open",
  [COMMENTS_FILTER.RESOLVED]: "Resolved",
} as const satisfies Record<CommentsFilter, string>;

const RESOLVED_PRESS = {
  SHOW: "Show resolved comments",
  HIDE: "Show open comments",
} as const;

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

const COMMENTS_SKELETON = [
  { author: "30%", words: ["100%", "70%"] },
  { author: "24%", words: ["100%", "85%", "40%"] },
  { author: "34%", words: ["90%"] },
] as const;

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

const NO_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: {
    title: "No comments",
    line: "Select words in the description, or press a block's comment button, to start a thread.",
  },
  [COMMENTS_FILTER.RESOLVED]: {
    title: "No resolved comments",
    line: undefined,
  },
} as const satisfies Record<CommentsFilter, { title: string; line: string | undefined }>;

function listedRank(card: DrawnCard): number {
  return card.thread?.createdAt ?? Number.POSITIVE_INFINITY;
}

const NO_SLOT = () => undefined;

const NO_FIND_ROWS: readonly FindRow[] = [];

const LISTED_ESTIMATE_PX = 200;

const LISTED_GAP_PX = 8;

function threadFindRow(thread: DescriptionCommentThread): FindRow {
  const entries = thread.entries.flatMap((entry) => [
    entry.words ?? "",
    ...(entry.files ?? []).map((file) => file.name),
  ]);
  return { key: thread.id, words: [quoteWords(thread), ...entries].join("\n") };
}

function ThreadList({
  control,
  listed,
  empty,
  doors,
  onShowWords,
  flush,
  scroller,
  handle,
}: {
  control: DescriptionCommentsControl;
  listed: readonly DescriptionCommentThread[];
  empty: { readonly title: string; readonly line: string | undefined };
  doors: ThreadDoors;
  onShowWords: (thread: DescriptionCommentThread) => (() => void) | undefined;
  flush?: boolean;
  scroller: RefObject<HTMLElement | null>;
  handle: RefObject<VirtualRowsHandle | null>;
}): React.JSX.Element {
  const held = useMarginCards(
    listed.map((thread) => ({ id: thread.id, thread, pending: undefined, top: 0, open: true })),
    true,
  );
  const rows = [...held.drawn].sort((a, b) => listedRank(a) - listedRank(b));
  const keys = rows.map((card) => card.id);
  const none = !control.failed && rows.length === 0 && control.read;
  const { gone } = held;
  useLayoutEffect(() => {
    for (const card of rows) {
      if (card.leaving && handle.current?.rowElement(card.id) === undefined) gone(card.id);
    }
  });
  return (
    <div
      className="comments-list box-border px-ui-16 pt-ui-16 pb-ui-24 data-empty:flex data-empty:min-h-full data-empty:flex-col data-flush:p-0"
      data-empty={none ? "" : undefined}
      data-flush={flush === true ? "" : undefined}
    >
      {control.failed ? (
        <ReplayUnmask>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_COMMENTS_READ)}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
            onRetry={control.onRetry}
          >
            The comments could not be read.
          </ErrorState>
        </ReplayUnmask>
      ) : none ? (
        <ReplayUnmask>
          <EmptyState replayUnmasked icon={<CommentsIcon />} title={empty.title}>
            {empty.line}
          </EmptyState>
        </ReplayUnmask>
      ) : !control.read ? (
        <CommentsSkeleton />
      ) : (
        <VirtualRows
          scroller={scroller}
          keys={keys}
          estimate={LISTED_ESTIMATE_PX}
          gap={LISTED_GAP_PX}
          anchor={VIRTUAL_ROWS_ANCHOR.START}
          holdsFocus
          handle={handle}
        >
          {(index) => {
            const card = rows[index];
            return card?.thread === undefined ? null : (
              <MarginSlot card={card} moves={false} slotRef={NO_SLOT} onGone={gone} flows>
                <CommentsRow>
                  <ThreadCard
                    thread={card.thread}
                    open
                    place={THREAD_PLACE.LIST}
                    quote
                    doors={doors}
                    onShowWords={onShowWords(card.thread)}
                  />
                </CommentsRow>
              </MarginSlot>
            );
          }}
        </VirtualRows>
      )}
    </div>
  );
}

export const COMMENTS_TOGGLE_CLASS = "comments-toggle";

const LISTING_WORDS = {
  LABEL: "Comments shown",
  [COMMENTS_FILTER.OPEN]: "Open",
  [COMMENTS_FILTER.RESOLVED]: "Resolved",
} as const;

const TOGGLE_WORDS = {
  LIST: "List all comments",
  MARGIN: "Show comments beside the description",
} as const;

function commentCount(threads: number): string {
  return `${threads} ${threads === 1 ? "comment" : "comments"}`;
}

export function CommentsToggle(): React.JSX.Element | null {
  const control = useDescriptionCommentsControlOrUndefined();
  const { listing, onListing } = useCommentFocus();
  if (control === undefined || control.threads.length === 0) return null;
  const listed = listing !== undefined;
  return (
    <span className={`${COMMENTS_TOGGLE_CLASS} actor-line`}>
      <Tooltip label={listed ? TOGGLE_WORDS.MARGIN : TOGGLE_WORDS.LIST}>
        <TextButton
          aria-expanded={listed}
          onClick={() => onListing(listed ? undefined : COMMENTS_FILTER.OPEN)}
        >
          <ReplayUnmask>{commentCount(control.threads.length)}</ReplayUnmask>
        </TextButton>
      </Tooltip>
    </span>
  );
}

function DescriptionCommentList({
  doors,
  listing,
  onListing,
  wide,
  top,
  scroller,
  shown,
}: {
  doors: ThreadDoors;
  listing: CommentsFilter;
  onListing: (listing: CommentsFilter) => void;
  wide: boolean;
  top: number;
  scroller: RefObject<HTMLDivElement | null>;
  shown: boolean;
}): React.JSX.Element {
  const { reveal, revealed } = useCommentFocus();
  const { control } = doors;
  const { threads: all } = control;
  const open = useMemo(() => all.filter(openThread), [all]);
  const resolved = useMemo(() => all.filter((thread) => !openThread(thread)), [all]);
  const listed = listing === COMMENTS_FILTER.OPEN ? open : resolved;
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  const finding = useFindOpen();
  const findRows = useMemo(
    () => (finding ? listed.map(threadFindRow) : NO_FIND_ROWS),
    [finding, listed],
  );
  useVirtualFind({ root: scroller, rows: findRows, handle: run, findable: shown });
  const scrolledAsk = useRef<number | undefined>(undefined);
  const broughtAsk = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const box = wide ? scroller.current : list.current;
    if (revealed === undefined || box === null || scrolledAsk.current === revealed.ask) return;
    const row = list.current?.querySelector(`.comment-card[data-thread="${revealed.thread}"]`);
    if (row == null) {
      if (broughtAsk.current === revealed.ask) return;
      broughtAsk.current = revealed.ask;
      run.current?.bringIn(revealed.thread);
      return;
    }
    scrolledAsk.current = revealed.ask;
    box.scrollTop +=
      row.getBoundingClientRect().top - box.getBoundingClientRect().top - REVEAL_ROOM;
  });
  const choice = (
    <ReplayUnmask>
      <ChoiceBar<CommentsFilter>
        label={LISTING_WORDS.LABEL}
        items={[
          {
            value: COMMENTS_FILTER.OPEN,
            label: LISTING_WORDS[COMMENTS_FILTER.OPEN],
            count: String(open.length),
          },
          {
            value: COMMENTS_FILTER.RESOLVED,
            label: LISTING_WORDS[COMMENTS_FILTER.RESOLVED],
            count: String(resolved.length),
          },
        ]}
        value={listing}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        size={CHOICE_BAR_SIZE.COMPACT}
        stretch
        onChange={onListing}
      />
    </ReplayUnmask>
  );
  const threads = (
    <ThreadList
      key={listing}
      control={control}
      listed={listed}
      empty={NO_COMMENTS[listing]}
      doors={doors}
      onShowWords={(thread) => (openThread(thread) ? () => reveal(thread.id) : undefined)}
      flush
      scroller={wide ? scroller : list}
      handle={run}
    />
  );
  return wide ? (
    <div
      ref={list}
      className="comment-list absolute left-comment-margin w-comment-card"
      style={{ top }}
    >
      {choice}
      {threads}
    </div>
  ) : (
    <div className="comment-float" style={{ top }}>
      <Card
        look={CARD_LOOK.WELL}
        shadow={CARD_SHADOW.MENU}
        padding={CARD_PADDING.SNUG}
        className="comment-list comment-list-float"
      >
        {choice}
        <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
          {threads}
        </ScrollArea>
      </Card>
    </div>
  );
}

function ThreadsPane({
  control,
  doors,
  filter,
  onFilter,
  empty,
  list,
  run,
  className,
  onShowWords,
  lead,
}: {
  control: DescriptionCommentsControl;
  doors: ThreadDoors;
  lead?: ReactNode;
  filter: CommentsFilter;
  onFilter: (filter: CommentsFilter) => void;
  empty: Record<CommentsFilter, { readonly title: string; readonly line: string | undefined }>;
  list: RefObject<HTMLDivElement | null>;
  run: RefObject<VirtualRowsHandle | null>;
  className: string;
  onShowWords: (thread: DescriptionCommentThread) => (() => void) | undefined;
}): React.JSX.Element {
  const listed = control.threads.filter((thread) =>
    filter === COMMENTS_FILTER.OPEN ? openThread(thread) : !openThread(thread),
  );
  return (
    <Fill className={className}>
      <WordsDatePickerRoom>
        <PaneBar
          title={COMMENTS_FILTER_WORDS[filter]}
          titleReplayUnmasked
          detail={listed.length}
          actions={
            <ResolvedOnly
              shown={filter === COMMENTS_FILTER.RESOLVED}
              onShown={(shown) => {
                onFilter(shown ? COMMENTS_FILTER.RESOLVED : COMMENTS_FILTER.OPEN);
                if (list.current !== null) list.current.scrollTop = 0;
              }}
            />
          }
        />
        <ScrollArea ref={list} fade={SCROLL_FADE.BOTH}>
          {lead === undefined || lead === null ? null : (
            <div className="box-border px-ui-16 pt-ui-16">{lead}</div>
          )}
          <ThreadList
            key={filter}
            control={control}
            listed={listed}
            empty={empty[filter]}
            doors={doors}
            onShowWords={onShowWords}
            scroller={list}
            handle={run}
          />
        </ScrollArea>
      </WordsDatePickerRoom>
    </Fill>
  );
}

export interface PageCommentOn {
  readonly element:
    | {
        readonly path: string;
        readonly quote: string;
        readonly section: string;
        readonly words?: true;
      }
    | undefined;
  readonly box: FrameBox | undefined;
}

function pageDraftOn(pageId: string) {
  return { quote: pageId, scope: DESCRIPTION_COMMENT_SCOPE.PAGE } as const;
}

export function pageDraftPlace(planId: string, pageId: string): DescriptionCommentPlace {
  return { kind: DRAFT_PLACE.DESCRIPTION_COMMENT, planId, on: pageDraftOn(pageId) };
}

export function withQuote(text: string, words: string): string {
  const kept = messageBlocks(text).filter(
    (block) => block.kind === MESSAGE_BLOCK.QUOTE || block.lines.some((line) => line.trim() !== ""),
  );
  return messageText([
    ...kept,
    { kind: MESSAGE_BLOCK.QUOTE, words: replyOf(words) },
    { kind: MESSAGE_BLOCK.WORDS, lines: [""] },
  ]);
}

const NO_PAGE_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: {
    title: "No comments",
    line: "Press Comment, then an element of the page, to start a thread with the agent that wrote it.",
  },
  [COMMENTS_FILTER.RESOLVED]: NO_COMMENTS[COMMENTS_FILTER.RESOLVED],
} as const satisfies Record<CommentsFilter, { title: string; line: string | undefined }>;

export const PAGE_COMMENT_WORDS = {
  COMMENT: "Comment on the page",
  PICKING: "Press an element of the page to comment on it",
  WHOLE_PAGE: "Whole page",
} as const;

const KEEPS_PAGE_CARD_OPEN = `${KEEPS_THREAD_OPEN}, .page-comment-pin`;

function keepsPageCardOpen(target: Node): boolean {
  return target instanceof Element && target.closest(KEEPS_PAGE_CARD_OPEN) !== null;
}

export function ownWordsIn(text: string): boolean {
  return messageBlocks(text).some(
    (block) => block.kind === MESSAGE_BLOCK.WORDS && block.lines.some((line) => line.trim() !== ""),
  );
}

export function PageComments({
  control,
  doors,
  open,
  filter,
  onFilter,
  onOpen,
  lead,
}: {
  control: DescriptionCommentsControl;
  lead?: ReactNode;
  doors: Omit<ThreadDoors, "control">;
  open: readonly string[] | undefined;
  filter: CommentsFilter;
  onFilter: (filter: CommentsFilter) => void;
  onOpen: (thread: DescriptionCommentThread | undefined) => void;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  usePressAway(NO_LAYER, () => undefined, {
    onPressAway: open === undefined ? undefined : () => onOpen(undefined),
    holds: keepsPageCardOpen,
  });
  const first = open?.[0];
  const opened = control.threads.find((thread) => thread.id === first);
  const openedFilter =
    opened === undefined
      ? undefined
      : openThread(opened)
        ? COMMENTS_FILTER.OPEN
        : COMMENTS_FILTER.RESOLVED;
  useEffect(() => {
    if (openedFilter !== undefined) onFilter(openedFilter);
  }, [first, openedFilter, onFilter]);
  useLayoutEffect(() => {
    if (first === undefined || list.current === null) return;
    const card = list.current.querySelector<HTMLElement>(`.comment-card[data-thread="${first}"]`);
    if (card === null) run.current?.bringIn(first);
    else centerWithin(list.current, card);
  }, [first, filter]);
  return (
    <ThreadsPane
      control={control}
      doors={{ ...doors, control }}
      filter={filter}
      onFilter={onFilter}
      empty={NO_PAGE_COMMENTS}
      list={list}
      run={run}
      lead={lead}
      className="page-comments relative h-full"
      onShowWords={(thread) =>
        thread.page?.element === undefined ? undefined : () => onOpen(thread)
      }
    />
  );
}

function inWindow(room: HTMLElement | null, box: FrameBox | undefined): FrameBox | undefined {
  if (room === null || box === undefined) return undefined;
  const at = room.getBoundingClientRect();
  return {
    left: at.left + box.left,
    top: at.top + box.top,
    right: at.left + box.right,
    bottom: at.top + box.bottom,
  };
}

const PIN_ROOM = 48;

function pinStands(box: FrameBox): CommentPinStands {
  return box.left < PIN_ROOM ? COMMENT_PIN_STANDS.INSIDE : COMMENT_PIN_STANDS.BESIDE;
}

const PAGE_TOP: FrameBox = { left: 0, top: 0, right: 0, bottom: 0 };

export function threadsByElement(
  threads: readonly DescriptionCommentThread[],
): ReadonlyMap<string, readonly DescriptionCommentThread[]> {
  const by = new Map<string, DescriptionCommentThread[]>();
  for (const thread of threads) {
    const path = thread.page?.element;
    if (path === undefined || !openThread(thread)) continue;
    by.set(path, [...(by.get(path) ?? []), thread]);
  }
  return by;
}

function firstLine(words: string): string {
  const said = messageBlocks(words).find((block) => block.kind === MESSAGE_BLOCK.WORDS);
  const line =
    said?.kind === MESSAGE_BLOCK.WORDS ? said.lines.find((each) => each.trim() !== "") : undefined;
  return line ?? words;
}

function PagePin({
  threads,
  doors,
  open,
  onOpen,
  onHint,
  stands,
}: {
  threads: readonly DescriptionCommentThread[];
  doors: Omit<ThreadDoors, "control">;
  open: boolean;
  onOpen: () => void;
  onHint: (over: boolean) => void;
  stands: CommentPinStands;
}): React.JSX.Element | null {
  const now = useMinute();
  const first = threads[0]?.entries.find(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT,
  );
  const fallback: DescriptionCommentWriter = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER };
  const { author } = useWriter(first?.writer ?? fallback, doors.agents);
  const comments = threads.length;
  return (
    <CommentPin
      author={author}
      count={comments}
      label={`${comments} ${comments === 1 ? "comment" : "comments"}`}
      open={open}
      stands={stands}
      onPress={onOpen}
      onHover={onHint}
      preview={
        first === undefined ? null : (
          <HoverCard>
            <WrittenComment writer={first.writer} agents={doors.agents} at={first.at} now={now}>
              <div className="comment-clamp line-clamp-2">{firstLine(first.words ?? "")}</div>
            </WrittenComment>
          </HoverCard>
        )
      }
    />
  );
}

export function HeldCommentCard({
  comment,
  onRemove,
}: {
  comment: HeldComment;
  onRemove: (() => void) | undefined;
}): React.JSX.Element {
  const { readerId } = useMemberDirectory();
  const reader = usePerson(readerId === undefined ? undefined : { userId: readerId, name: "" });
  return (
    <CommentCard place={THREAD_PLACE.LIST} open data-thread={comment.clientKey}>
      <div className="flex min-w-0 flex-col gap-tight-gap">
        <Comment
          author={commentAuthor(reader)}
          nameRef={<ActorRef actor={reader} nameOnly />}
          trailing={
            <QuietWords>
              <ReplayUnmask>{PAGE_REVIEW_WORDS.PENDING}</ReplayUnmask>
            </QuietWords>
          }
        >
          {comment.element === undefined ? (
            <QuietWords>
              <ReplayUnmask>{PAGE_REVIEW_WORDS.WHOLE_PAGE}</ReplayUnmask>
            </QuietWords>
          ) : null}
          {comment.attachments.length > 0 ? (
            <AttachedFileChips files={attachmentChips(comment.attachments)} />
          ) : null}
          <CommentWords words={comment.words} />
        </Comment>
        {onRemove === undefined ? null : (
          <div>
            <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={onRemove}>
              <ReplayUnmask>{PAGE_REVIEW_WORDS.REMOVE}</ReplayUnmask>
            </TextButton>
          </div>
        )}
      </div>
    </CommentCard>
  );
}

const HELD_PIN_STEP = 28;

function HeldPin({
  held,
  stands,
  onOpen,
  onHint,
}: {
  held: readonly HeldComment[];
  stands: CommentPinStands;
  onOpen: () => void;
  onHint: (over: boolean) => void;
}): React.JSX.Element {
  const { readerId } = useMemberDirectory();
  const reader = usePerson(readerId === undefined ? undefined : { userId: readerId, name: "" });
  const first = held[0];
  return (
    <CommentPin
      author={commentAuthor(reader)}
      count={held.length}
      label={PAGE_REVIEW_WORDS.pin(held.length)}
      open={false}
      look={COMMENT_PIN_LOOK.HELD}
      stands={stands}
      onPress={onOpen}
      onHover={onHint}
      preview={
        first === undefined ? null : (
          <HoverCard>
            <div className="comment-clamp line-clamp-2">{firstLine(first.words)}</div>
          </HoverCard>
        )
      }
    />
  );
}

function heldByElement(held: readonly HeldComment[]): ReadonlyMap<string, readonly HeldComment[]> {
  const by = new Map<string, HeldComment[]>();
  for (const comment of held) {
    const path = comment.element?.path;
    if (path !== undefined) by.set(path, [...(by.get(path) ?? []), comment]);
  }
  return by;
}

export function PageCommentLayer({
  control,
  doors,
  page,
  room,
  marks,
  selected,
  picking,
  pending,
  open,
  floats,
  onOpen,
  onHint,
  onReply,
  onWholePage,
  onStopPick,
  onStarted,
  onCancel,
  review,
}: {
  control: DescriptionCommentsControl;
  doors: Omit<ThreadDoors, "control">;
  review?: { readonly control: PageReviewControl; readonly onOpen: () => void } | undefined;
  page: { readonly id: string; readonly version: number };
  room: RefObject<HTMLElement | null>;
  marks: ReadonlyMap<string, FrameBox | null>;
  selected: PagePicked | undefined;
  picking: boolean;
  pending: PageCommentOn | undefined;
  open: readonly string[] | undefined;
  floats: boolean;
  onOpen: (threads: readonly string[] | undefined) => void;
  onHint: (path: string | undefined) => void;
  onReply: (selected: PagePicked) => void;
  onWholePage: () => void;
  onStopPick: () => void;
  onStarted: (threadId: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const full = { ...doors, control };
  const byElement = threadsByElement(control.threads);
  const opened = control.threads.filter((thread) => open?.includes(thread.id) === true);
  const at = opened[0]?.page?.element;
  const starting = useRef<HTMLDivElement>(null);
  const pins = [...byElement].flatMap(([path, threads]) => {
    const box = marks.get(path);
    if (box === undefined || box === null || box.bottom < 0) return [];
    return [{ path, threads, box }];
  });
  const heldPins = [...heldByElement(review?.control.held ?? [])].flatMap(([path, held]) => {
    const box = marks.get(path);
    if (box === undefined || box === null || box.bottom < 0) return [];
    return [{ path, held, box, step: byElement.has(path) ? HELD_PIN_STEP : 0 }];
  });
  return (
    <div className="page-comment-layer">
      {review === undefined
        ? null
        : heldPins.map(({ path, held, box, step }) => (
            <span
              key={path}
              className="page-comment-pin"
              data-stands={pinStands(box)}
              style={{ left: Math.max(box.left - step, 0), top: Math.max(box.top, 0) }}
            >
              <HeldPin
                held={held}
                stands={pinStands(box)}
                onOpen={review.onOpen}
                onHint={(over) => onHint(over ? path : undefined)}
              />
            </span>
          ))}
      {pins.map(({ path, threads, box }) => (
        <span
          key={path}
          className="page-comment-pin"
          data-stands={pinStands(box)}
          style={{ left: Math.max(box.left, 0), top: Math.max(box.top, 0) }}
        >
          <PagePin
            threads={threads}
            doors={doors}
            open={threads.some((thread) => open?.includes(thread.id) === true)}
            onOpen={() =>
              onOpen(
                threads.some((thread) => open?.includes(thread.id) === true)
                  ? undefined
                  : threads.map((thread) => thread.id),
              )
            }
            onHint={(over) => onHint(over ? path : undefined)}
            stands={pinStands(box)}
          />
        </span>
      ))}
      <RectFloat
        open={floats && opened.length > 0}
        anchor={() =>
          inWindow(room.current, at === undefined ? PAGE_TOP : (marks.get(at) ?? undefined))
        }
        side={POPOVER_SIDE.BELOW}
        onPressAway={() => onOpen(undefined)}
        holds={keepsPageCardOpen}
      >
        <div className="page-comment-float page-comment-threads">
          <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
            <div className="comment-float-cards">
              {opened.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  open
                  place={THREAD_PLACE.FLOAT}
                  doors={full}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </RectFloat>
      <RectFloat
        open={pending !== undefined}
        anchor={() => inWindow(room.current, pending?.box ?? PAGE_TOP)}
        side={POPOVER_SIDE.BELOW}
        onPressAway={() => {
          if (starting.current?.querySelector('[data-held="true"]') === null) onCancel();
        }}
        holds={keepsPageCardOpen}
      >
        {pending === undefined ? null : (
          <div ref={starting} className="page-comment-float">
            <PendingCard
              on={pageDraftOn(page.id)}
              place={THREAD_PLACE.FLOAT}
              doors={full}
              begin={(first) => ({
                ...first,
                page: { id: page.id, version: page.version },
                ...(pending.element === undefined ? undefined : { element: pending.element }),
              })}
              onStarted={onStarted}
              onCancel={onCancel}
              review={
                review === undefined
                  ? undefined
                  : {
                      open: review.control.held.length > 0,
                      onHold: (words, attachments) =>
                        review.control.hold({
                          clientKey: crypto.randomUUID(),
                          version: page.version,
                          element: pending.element,
                          words,
                          attachments,
                        }),
                    }
              }
            />
          </div>
        )}
      </RectFloat>
      {picking ? (
        <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR} className="page-comment-hint">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {PAGE_COMMENT_WORDS.PICKING}
          </Text>
          <Button onClick={onWholePage}>{PAGE_COMMENT_WORDS.WHOLE_PAGE}</Button>
          <Button onClick={onStopPick}>{COMMENT_WORDS.CANCEL}</Button>
        </MenuSurface>
      ) : selected === undefined ? null : (
        <SelectedReply room={room} selected={selected} onReply={onReply} />
      )}
    </div>
  );
}

function SelectedReply({
  room,
  selected,
  onReply,
}: {
  room: RefObject<HTMLElement | null>;
  selected: PagePicked;
  onReply: (selected: PagePicked) => void;
}): React.JSX.Element | null {
  const box = inWindow(room.current, selected.box);
  if (box === undefined) return null;
  return <ReplyPress place={pressPlace(box)} onReply={() => onReply(selected)} />;
}
