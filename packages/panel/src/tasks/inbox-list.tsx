import { INBOX_ASK, INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BADGE_TONE,
  Badge,
  BUTTON_SIZE,
  CHIP_LOOK,
  Chip,
  ChipName,
  ComposeIcon,
  DocumentIcon,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ErrorState,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  LIST_ROW_META,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  ScrollArea,
  SearchField,
  SearchIcon,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TaskStatusMark,
  Time,
  Tooltip,
  useMenu,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  actorName,
  memberActor,
  personActor,
} from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import * as Atom from "effect/reactivity/Atom";
import {
  ArrowDownNarrowWideIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ClockArrowDownIcon,
  ClockArrowUpIcon,
  FactoryIcon,
  HourglassIcon,
  ImagesIcon,
  InboxIcon,
  ListIcon,
  ListTodoIcon,
  MailIcon,
  MailOpenIcon,
  PenLineIcon,
  Rows2Icon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  SquareIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref.js";
import { AttentionMark } from "../attention-mark.js";
import { useAutomation } from "../automation-directory.js";
import { useInboxItemDraft, useInboxItemDrafted } from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar.js";
import {
  INBOX_LIST_WIDTH,
  type InboxShowChoice,
  type InboxTaskFolds,
  type InboxViewChoices,
  type InboxWhoseChoice,
  useInboxListWidth,
} from "../desktop/folded-groups.js";
import { SidebarGroupHeader } from "../desktop/sidebar-group-header.js";
import { SidebarSectionHead } from "../desktop/sidebar-task-view.js";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge.js";
import { DraftMark } from "../draft-mark.js";
import { FadingWords } from "../fading-words.js";
import { useMemberDirectory } from "../member-directory.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref.js";
import { TaskChipCard } from "./chip-cards.js";
import { agentStillWriting, providerOf } from "./coding-agent-model.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  listHeadControl,
  VIEW_OPTIONS,
} from "./inbox-columns.js";
import { NEW_THREAD } from "./inbox-compose.js";
import {
  EVERYONES,
  holderKey,
  holderName,
  INBOX_GROUPING,
  INBOX_HOLDER,
  INBOX_LINE,
  INBOX_SHOW,
  INBOX_SORT,
  INBOX_STATUS_GROUP,
  INBOX_WHOSE,
  type InboxCounts,
  type InboxGrouping,
  type InboxHolder,
  type InboxKnownAsk,
  type InboxLineKind,
  type InboxListed,
  type InboxListView,
  type InboxPerson,
  type InboxPersonGroup,
  type InboxShow,
  type InboxSort,
  type InboxStatusGroup,
  type InboxStatusGroupKind,
  type InboxWhose,
  inboxCardThread,
  inboxLineKind,
  inboxMedia,
  inboxPreview,
  inboxSettledStanding,
  inboxSettledWords,
  inboxShownTicks,
  inboxWaitsOn,
  isDone,
  isUnread,
  listedItems,
  NEEDS_YOU,
  needsYou as needsYouOf,
  readersItem,
} from "./inbox-model.js";
import {
  RowMedia,
  type RowMediaReads,
  useRowMediaAsks,
  useRowMediaReads,
} from "./inbox-row-media.js";
import {
  type InboxLeaves,
  InboxLeavesProvider,
  InboxRowMotion,
  LEAVING,
  useLeaving,
} from "./inbox-row-motion.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PlanGlyph } from "./tab-look.js";
import { markReadItem } from "./task-menu-items.js";
import { TASK_STATUS_WORDS, TaskKey } from "./task-standing.js";
import { cardTitle, plainWords } from "./tool-call-model.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its task's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, on the Inbox's own ground, so it reads as the
 * sidebar does. A task's items stand under the sidebar's own group header
 * (`sidebar-group-header.tsx`), the task's glyph giving way to its chevron
 * under the pointer, a press folding the group, and each fold kept across
 * launches as a sidebar group's is; an automation's agents stand under its
 * clock tile, which hangs its card. An item is a row of two lines, as a
 * mail app lists a thread: the tile of the agent that posted it
 * (`actor-ref.tsx`), as the task's summary or main's read of an agent with
 * no task names the agent, its title, and how long ago it last changed,
 * and before its time the face of the teammate whose agent asks it, as the
 * sidebar marks a teammate's task, the reader's own wearing none; under
 * them, muted, the last word in its thread, who said it first
 * (`inboxPreview`); a press chooses it, for the pane beside the list to
 * show. The tile hangs the agent's tab's card while the pointer rests on
 * it (`agent-ref.tsx`), and leaves the press to its row, whose pane opens
 * the agent. An item that needs the developer's answer, an open one their
 * own agent asks (`needsReader`), wears the attention mark before its time
 * (`attention-mark.tsx`), in either grouping and filtered or not; a
 * teammate's open item waits on the teammate, whose face stands in that
 * place, and any member may still answer it; an answered one wears
 * neither. Apart from whether it waits, an item is unread where it changed
 * since the developer last read it, or they marked it so: the blue dot in
 * a gutter before its tile, its title in the unread weight; opening it
 * reads it, and its row, its menu, U, and Mark all as read in the view's
 * menu mark it read or unread (`use-inbox-read-marks.ts`). An item settled
 * and read is done with (`isDone`), and its row stands back, gray, with no
 * word saying so: the chosen row To do keeps once it is answered or read,
 * until another is chosen (`use-held-inbox-list.ts`), and every such row All lists. A folded task
 * counts what in it needs the developer, at rest, and says nothing where
 * none does. The head names the Inbox and, at its right, offers the view's
 * menu: first what the list holds, To do, the developer's own items they are
 * not done with, asks waiting on them and anything of theirs unread, a
 * settled thread its agent wrote on again among them, or All, every item,
 * the head naming All after the Inbox's name; then Group by, by task, by
 * person, by status (what needs the developer
 * under the attention mark, what waits on others, what is answered, each
 * folding as a task's group does), or None, one run; Sort, the latest
 * change first or the oldest first; Whose, everyone's
 * items, the developer's own, or one teammate's by face and name, which a
 * chip over the list then says, its × listing everyone's again; each
 * choice checked; Media previews, off until first pressed and checked while
 * each row shows the pictures and pages its item carries, drawn small under
 * its preview (`inbox-row-media.tsx`); and under them Mark all as read,
 * which clears the dots alone. Every
 * choice is kept across launches. Grouped by person, each person's items
 * stand under their face, the reader's own first as You. Grouped by
 * anything but task, a row names its task in a chip before its preview,
 * since no task's header stands over it. Where the scope leaves out every
 * item listed, the list says so in the Inbox's empty state, offering the
 * scope that holds something, as a mail app's empty unread view does; the
 * item the pane shows keeps its place there, though no row. A task's own
 * Inbox lists one task's items in one run, so its view's menu offers To do
 * and All alone, kept apart
 * from the window's, and its list has no groups. Either list
 * is resized from its right edge as the sidebar is, and keeps one width
 * between them across launches; an Inbox showing one column at a time
 * draws its list the whole Inbox wide, with no edge, and hides it while an
 * item stands in its place (`inbox-columns.ts`).
 */

/** What an item's row's right-click menu is called. */
const ITEM_ACTIONS = "Inbox item actions";

/** What an unread row says to a reader, its dot being drawn for the eye alone. */
const UNREAD = "Unread";

/** What a row's swipe button says it does: marks the item read, or unread. */
const SWIPE_WORDS = { READ: "Read", UNREAD: "Unread" } as const;

/** What the view's menu offers to clear every dot with. */
const MARK_ALL_READ = "Mark all as read";

/** What the view's menu offers to show or hide the media under each row's preview with. */
const MEDIA_PREVIEWS = "Media previews";

/** What the view's menu offers to show or hide each row's second line with, its rows one line where it is off. */
const SECOND_LINE = "Second line";

/** The items whose media the rows show while they show none, kept as one so the reads see no change. */
const NO_ITEMS: readonly string[] = [];

/** What the view's submenu of groupings is called. */
const GROUP_BY = "Group by";

/** What the list's placeholder rows say to a reader while its items are first read. */
const READING_ITEMS = "Reading your inbox…";

/** How wide each placeholder row's title and the preview under it stand, as shares of their lines, so the rows read as items of their own. */
const SKELETON_ROWS = [
  { title: "68%", preview: "84%" },
  { title: "52%", preview: "70%" },
  { title: "74%", preview: "90%" },
  { title: "46%", preview: "62%" },
  { title: "60%", preview: "78%" },
] as const;

/** How wide a placeholder row's time stands, as wide as a short "2h". */
const SKELETON_TIME = "20px";

/** How wide a placeholder row's context stands, as wide as a short plan's name in a row's caption type. */
const SKELETON_CONTEXT = "7em";

/** How wide a placeholder row's mark stands, an agent's tile at its inline size (`.actor-mark`). */
const SKELETON_MARK = "16px";

/** What each scope is called, in the view's menu and, but for To do, after the Inbox's name at its head, and its glyph in the menu. */
const SCOPE_WORDS = {
  [INBOX_SHOW.TO_DO]: { label: "To do", icon: <ListTodoIcon /> },
  [INBOX_SHOW.ALL]: { label: "All", icon: <InboxIcon /> },
} as const satisfies Record<InboxShow, { label: string; icon: React.JSX.Element }>;

/** The scopes every Inbox's view's menu offers, in its order. */
const INBOX_SCOPES = [INBOX_SHOW.TO_DO, INBOX_SHOW.ALL] as const satisfies readonly InboxShow[];

/** The Inbox's name at its head: the scope after it, but for To do, where the Inbox opens, since no other control on the head says it. */
function inboxTitle(show: InboxShow): string {
  return show === INBOX_SHOW.TO_DO ? "Inbox" : `Inbox · ${SCOPE_WORDS[show].label}`;
}

/**
 * What the list says where its scope leaves out every item it holds.
 * All leaves out only what Whose does.
 */
const SHOW_EMPTY = {
  [INBOX_SHOW.TO_DO]: "Nothing to do",
  [INBOX_SHOW.ALL]: "Nothing here",
} as const satisfies Record<InboxShow, string>;

/** What the empty state's press says, by the scope it shows instead. */
const SHOW_INSTEAD = {
  [INBOX_SHOW.ALL]: "Show all",
} as const;

/** The scope an empty scope offers instead: All from To do where it holds anything; none where nothing is there to show. */
function insteadOf(show: InboxShow, counts: InboxCounts): keyof typeof SHOW_INSTEAD | undefined {
  return show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0 ? INBOX_SHOW.ALL : undefined;
}

/** What All says where Whose, naming someone, leaves out every item. */
const NOTHING_THEIRS = "Nothing in the Inbox is theirs";

/** What the empty state's press says where it lists everyone's items again, Whose having left out every item. */
const SHOW_EVERYONES = "Show everyone's";

/** What each status group is called, and its glyph, a list grouped by status heading it. */
const STATUS_WORDS = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: NEEDS_YOU.LABEL,
  [INBOX_STATUS_GROUP.WAITING]: "Waiting on others",
  [INBOX_STATUS_GROUP.ANSWERED]: "Answered",
} as const satisfies Record<InboxStatusGroupKind, string>;

/** What the view's submenu of sorts and of whose items are called. */
const SORT_BY = "Sort";
const WHOSE = "Whose";

/** What the chip over the list says its × does. */
const CLEAR_WHOSE = "Show everyone's items";

/** What a teammate's open item says to a reader beside their face, which is drawn for the eye alone: it waits on them, not the reader. */
function waitingOn(starter: Actor): string {
  return `Waiting on ${actorName(starter, { sentence: true })}`;
}

/** The tile of an agent the window names nothing of. */
const UNNAMED_AGENT = {
  kind: ACTOR_KIND.AGENT,
  name: "",
  provider: undefined,
  state: ACTOR_STATE.REST,
} as const;

/**
 * What the list leaves the item beside it, in CSS pixels: the list is
 * dragged no wider than the Inbox less this, so the item keeps the room a
 * question, a code card, and its options read in. An Inbox too narrow for
 * both at their least shows one at a time (`inbox-columns.ts`).
 */
const PANE_RESERVE = 560;

/**
 * The width the list is drawn at: the one kept, held no wider than the
 * Inbox less the pane's reserve, though never under the least, so a window
 * narrowed under a wide list still leaves the pane its room, and widened
 * again gives the list back as it was kept; the whole Inbox wide where it
 * stands alone. The Inbox is the container the width is measured against
 * (`.inbox-view` in desktop.css).
 */
function drawnWidth(width: number, alone: boolean): string | undefined {
  if (alone) return undefined;
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

/** The agent that posted an item as its holder names it: the task's summary's line, or main's line for an agent with no task; none where neither holds it. */
function itemSubject(
  holder: InboxHolder,
  agentId: string,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject | undefined {
  if (holder.kind === INBOX_HOLDER.AUTOMATION) {
    const line = holder.agents.get(agentId);
    return line === undefined
      ? undefined
      : tasklessSubject(
          {
            title: line.agentTitle,
            model: line.agentModel,
            automationId: line.automationId,
            automationName: holder.automationId === null ? undefined : holder.name,
          },
          models,
        );
  }
  const line = holder.task.agents?.agents.find((each) => each.id === agentId);
  return line === undefined ? undefined : lineSubject(line, models, readerId);
}

/**
 * The tile of the agent that posted an item, hanging the agent's card and
 * leaving the press to its row; where the holder names no such agent, an
 * archived one say, whose items still stand, a bare tile of the harness
 * read for it on its task (`ReadAgentModel`), and of no known harness
 * while that is read and where nothing is.
 */
export function ItemMark({
  holder,
  agentId,
  models,
  readerId,
  plain = false,
}: {
  holder: InboxHolder;
  agentId: string;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  /** Whether the tile hangs no card of its own, as a row's leading mark does, the row's own card naming the agent instead. */
  plain?: boolean;
}): React.JSX.Element {
  const subject = itemSubject(holder, agentId, models, readerId);
  if (subject === undefined) {
    if (holder.kind !== INBOX_HOLDER.TASK) return <ActorMark actor={UNNAMED_AGENT} />;
    return (
      <ReadAgentModel agentId={agentId} taskId={holder.task.id}>
        {(model) => (
          <ActorMark
            actor={{
              ...UNNAMED_AGENT,
              provider: model === undefined ? undefined : providerOf(model),
            }}
          />
        )}
      </ReadAgentModel>
    );
  }
  return plain ? (
    <ActorMark actor={subject.tile} />
  ) : (
    <AgentMarkRef subject={subject} models={models} />
  );
}

/** Where an item stands, as its row's card says it under its title. */
function standingWords(item: InboxItem, needsYou: boolean, starter: Actor | undefined): string {
  if (needsYou) return NEEDS_YOU.LABEL;
  if (item.status === INBOX_STATUS.OPEN) {
    return starter === undefined ? "Waiting" : waitingOn(starter);
  }
  return inboxSettledStanding(item);
}

/**
 * An Inbox row's card, hung beside the row as a sidebar task's row hangs
 * its task's, so the row's tile hangs none of its own: the card of the
 * thread. It leads with what holds it, a task as its key and its chip,
 * which wears its status, or an automation by its name, as a task's card
 * leads with where it stands; then the item's title and when it last moved; where it stands,
 * waiting on the reader, on a teammate, or settled;
 * the ask in full while one waits, every option with the recommended one
 * marked or every step as the reader's draft ticks it, or how it ended; and
 * the agent's latest words, three lines at most. The agent that asked
 * stands at its foot, the loading spinner beside it while it works.
 */
function InboxItemCard({
  listed,
  now,
  models,
  readerId,
  needsYou,
  starter,
  settled,
}: {
  listed: InboxListed;
  now: number;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  needsYou: boolean;
  starter: Actor | undefined;
  /** How the item ended, as its row's second line says it, where nothing waits any longer. */
  settled: string | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const subject = itemSubject(holder, item.agentId, models, readerId);
  const thread = inboxCardThread(item);
  const ticked = inboxShownTicks(item, useInboxItemDraft(item));
  // Note that a task's row names what each of its agents is doing; an agent with no task carries no such word, and shows no spinner.
  const line =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.agents?.agents.find((each) => each.id === item.agentId)
      : undefined;
  const working = line !== undefined && agentStillWriting(line.status);
  return (
    <HoverCard data-inbox-row-card="">
      <HolderLine holder={holder} />
      <HoverCardHead
        name={cardTitle(item.title)}
        sub={
          <>
            {needsYou ? <AttentionMark /> : null}
            <span>{standingWords(item, needsYou, starter)}</span>
          </>
        }
        corner={<Time at={item.updatedAt} now={now} hint={false} />}
      />
      {thread.ask === undefined ? (
        settled === undefined ? null : (
          <HoverCardRow look={HOVER_CARD_ROW_LOOK.DETAIL} glyph={<CheckIcon />} label={settled} />
        )
      ) : (
        <CardAsk ask={thread.ask} ticked={ticked} title={cardTitle(item.title)} />
      )}
      {thread.words === "" ? null : <HoverCardNote>{thread.words}</HoverCardNote>}
      <HoverCardRule />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={
          <ItemMark
            holder={holder}
            agentId={item.agentId}
            models={models}
            readerId={readerId}
            plain
          />
        }
        label={subject?.name ?? UNNAMED_AGENT.name}
        end={working ? <StateGlyph state={GLYPH_STATE.WORKING} /> : undefined}
      />
    </HoverCard>
  );
}

/** The account's workspaces, which tell their readers only as the list moves, not as the tasks beside it do. */
const WORKSPACES = Atom.map(APP_SLICE.TASKS, (tasks) => tasks?.workspaces);

/**
 * What holds an item, as its card leads with it, on one line: a task by its
 * key, as the task's own card leads with it (`TaskKey`), and by its chip
 * as a mention of it is drawn (`HolderRef`), which wears the task's status
 * as its mark, so the card says no status in words; an automation, or the
 * agents no automation names, by their chip alone.
 */
function HolderLine({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const workspaces = useAppSlice(WORKSPACES);
  const workspaceName =
    holder.kind === INBOX_HOLDER.TASK
      ? workspaces?.find((each) => each.id === holder.task.workspaceId)?.name
      : undefined;
  return (
    <div className="task-card-standing" data-line="one">
      {holder.kind === INBOX_HOLDER.TASK ? (
        <TaskKey workspaceName={workspaceName} number={holder.task.number} />
      ) : null}
      <HolderRef holder={holder} />
    </div>
  );
}

/**
 * What holds an item, named as a mention of it is (`mention-chip.tsx`): a
 * pill of its glyph and its name, cut at its end where the card is too
 * narrow for it. A task's hangs the task's card and opens the task, as a
 * mention of the task does; an automation's hangs its card where the window
 * reads it; the agents no automation names hang their name alone.
 */
function HolderRef({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const openPlace = useOpenPlace();
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  const glyph = <HolderGlyph holder={holder} />;
  const name = holderName(holder);
  if (holder.kind !== INBOX_HOLDER.TASK) {
    return (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={glyph}
        label={name}
        card={known === undefined ? undefined : <AutomationCard {...known} />}
        data-holder-ref=""
        data-kind={holder.kind}
      />
    );
  }
  const { task } = holder;
  const fallback = (
    <HoverCard>
      <HoverCardHead glyph={glyph} name={name} />
    </HoverCard>
  );
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={glyph}
      label={name}
      card={<TaskChipCard taskId={task.id} fallback={fallback} />}
      onPress={
        openPlace === undefined
          ? undefined
          : () => openPlace({ kind: LINK_PLACE.TASK, planId: task.id })
      }
      data-holder-ref=""
      data-kind={holder.kind}
    />
  );
}

/** An open ask as an item's card shows it in full: a choice's options, the recommended one marked; a to-do's steps, ticked as the reader's draft ticks them; or what a form or an answer asks. */
function CardAsk({
  ask,
  ticked,
  title,
}: {
  ask: InboxKnownAsk;
  ticked: readonly number[];
  /** The item's title, which a to-do naming no steps of its own asks as its one step, as its box shows it. */
  title: string;
}): React.JSX.Element {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return (
        <HoverCardList label="Options">
          {ask.options.map((option) => (
            <li key={option.label}>
              <HoverCardRow
                glyph={<CircleIcon aria-hidden="true" />}
                label={option.label}
                end={
                  option.label === ask.recommended ? (
                    <Badge tone={BADGE_TONE.ATTENTION}>{RECOMMENDED}</Badge>
                  ) : undefined
                }
              />
            </li>
          ))}
        </HoverCardList>
      );
    case INBOX_ASK.DO:
      return (
        <HoverCardList label="Steps">
          {(ask.steps.length === 0 ? [title] : ask.steps).map((step, at) => (
            <li key={at} data-done={ticked.includes(at) ? "true" : undefined}>
              <HoverCardRow
                glyph={
                  ticked.includes(at) ? (
                    <SquareCheckIcon aria-hidden="true" />
                  ) : (
                    <SquareIcon aria-hidden="true" />
                  )
                }
                label={plainWords(step)}
              />
            </li>
          ))}
        </HoverCardList>
      );
    case INBOX_ASK.ANSWER:
      return (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={<PenLineIcon />}
          label={
            ask.fields === undefined
              ? "Write an answer"
              : `Fill in ${ask.fields.map((field) => field.label).join(", ")}`
          }
        />
      );
  }
}

/** What marks a choice's option the agent recommends, on an item's card. */
const RECOMMENDED = "Recommended";

/** The glyph leading an item's second line: its open ask's kind, a tick where an answer settled it, and none before words alone. */
function lineGlyph(kind: InboxLineKind): React.JSX.Element | null {
  switch (kind) {
    case INBOX_LINE.DECIDE:
      return <CircleDotIcon aria-hidden="true" />;
    case INBOX_LINE.DO:
      return <SquareCheckIcon aria-hidden="true" />;
    case INBOX_LINE.ANSWER:
      return <PenLineIcon aria-hidden="true" />;
    case INBOX_LINE.SETTLED:
      return <CheckIcon aria-hidden="true" />;
    case INBOX_LINE.SAID:
      return null;
  }
}

/**
 * One item as a `ListRow` of two lines, as a mail app lists a thread: the
 * agent's mark, the title, its task's status (`TaskStatusChip`), and how
 * long ago it changed, then the last word
 * in its thread, muted, led on a thread by what its open ask asks, the
 * steps its draft ticks counted (`inboxPreview`). One that needs the developer wears
 * the attention mark before its time, and a teammate's item their face
 * there where `face` allows it, the mark of their open item being theirs to
 * wear. The title hangs in the window's pill, since a narrow list cuts it
 * short. An unread item, changed since the developer last read it or marked
 * unread, wears the blue dot in a gutter before its tile, its title in the
 * unread weight and its preview in the body's ink; the gutter stands on
 * every row, so the tiles line up whether a row wears a dot or not. Where
 * an answer or a message waits unsent in the item's box and that box is not
 * the one standing beside the list, which shows its own words, the row wears
 * the Draft pencil before its marks, as a sidebar task's row does
 * (`draft-mark.tsx`).
 * Where the list hands down `onMark`, the row offers to mark it read or unread:
 * a press over its time while the pointer rests on it or it holds the
 * keyboard, the time and its marks stepping aside, and the first item of
 * its right-click menu, which names the key that does the same to the
 * chosen item (`APP_COMMAND.TOGGLE_INBOX_ITEM_READ`); and a swipe right, a
 * short one leaving the row open on a Read or Unread button, a long one
 * marking it as it is let go (`@luke/ui`'s `ListRow` swipe). The home page's Inbox
 * names the item's plan at the row's end, in `context`, since its rows stand
 * under no plan's header; the Inbox's own list, grouped by anything but
 * task, names it in a chip before the preview instead (`chip`), its glyph
 * and its name cut short, so the title keeps its whole line. Its right-click offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under. Where the list hands
 * down its media reads (`media`), the row shows the pictures and pages its
 * item carries under its preview (`inbox-row-media.tsx`). Where the list
 * hands down `onClose`, an open item's row offers to close it without an
 * answer, asked first (`inbox-close.tsx`): a press beside its mark while
 * the pointer rests on it or it holds the keyboard, and the last item of
 * its right-click menu.
 */
export function InboxItemRow({
  listed,
  chosen,
  open = chosen,
  now,
  models,
  readerId,
  context,
  face = true,
  chip = false,
  line = true,
  muted = false,
  media,
  ref,
  onChoose,
  onMark,
  onClose,
}: {
  listed: InboxListed;
  chosen: boolean;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked: the chosen item's unless said, and none while the list stands alone. */
  open?: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards and rows name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
  context?: string;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the row names its task, or its automation, in a chip before its preview, as a list its tasks do not head does. */
  chip?: boolean;
  /** Whether the row draws its second line, what its item asks or how it ended; off, the row is its title's line alone, as the view's menu may choose. */
  line?: boolean;
  /** Whether the row is drawn gray, its item done with (`isDone`), as the Inbox's own list draws it; nothing says so in words, since its marks and its card do. */
  muted?: boolean;
  /** The list's reads of its rows' media, where the row shows its item's; none where it shows none. */
  media?: RowMediaReads | undefined;
  /** Handed the row's press, by which the list finds the row of an item. */
  ref?: React.RefCallback<HTMLElement> | undefined;
  onChoose: (listed: InboxListed) => void;
  /** Marks the item read or unread; none where the row offers no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
  /** Closes an open item without an answer; none where the row offers no close. */
  onClose?: InboxCloser | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const title = cardTitle(item.title);
  const directory = useMemberDirectory();
  const reader = directory.readerId ?? readerId;
  const needsYou = needsYouOf(listed, reader);
  const drafted = useInboxItemDrafted(item) && !open;
  const starter = readersItem(item, reader)
    ? undefined
    : personActor(inboxWaitsOn(item), directory.members, reader, directory.former);
  const ticked = inboxShownTicks(item, useInboxItemDraft(item));
  const lineKind = inboxLineKind(item);
  const nameOf = (member: Parameters<typeof personActor>[0]) =>
    actorName(personActor(member, directory.members, reader, directory.former));
  const preview = inboxPreview(item, nameOf, ticked);
  const carried = useMemo(() => inboxMedia(item), [item]);
  useRowMediaAsks(item.id, item.updatedAt, carried, media);
  const menu = useMenu(true);
  const copyLink = useCopyLinkItem()(
    holder.kind === INBOX_HOLDER.TASK
      ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.task.id, itemId: item.id }
      : { kind: LINK_PLACE.INBOX_ITEM, agentId: item.agentId, itemId: item.id },
  );
  const read =
    onMark === undefined
      ? undefined
      : {
          ...markReadItem({ unread, onMark: (next) => onMark(listed, next) }),
          command: APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
        };
  const close = useInboxClose(item, onClose, true);
  const groups = [
    read === undefined ? [] : [read],
    copyLink === undefined ? [] : [copyLink],
    close.action === undefined ? [] : [close.action],
  ].filter((group) => group.length > 0);
  const press = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control, as a sidebar task's row does.
  const region = useRef<HTMLElement | null>(null);
  const hold = useCallback(
    (element: HTMLElement | null) => {
      press.current = element;
      region.current = element?.parentElement ?? null;
      ref?.(element);
    },
    [ref],
  );
  return (
    <>
      <RowHintOptions
        card={
          <InboxItemCard
            listed={listed}
            now={now}
            models={models}
            readerId={readerId}
            needsYou={needsYou}
            starter={starter}
            settled={inboxSettledWords(item, nameOf)}
          />
        }
        cardBeside
        cardRegion={region}
      >
        <ListRow
          ref={hold}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={
            <>
              {/* Note that the gutter stands on every row, so the tiles line up whether a row wears the dot or not. */}
              <span className="inbox-row-gutter">
                {unread ? <span className="inbox-row-unread" /> : null}
              </span>
              {/* Note that the tile hangs no card of its own, as a sidebar task's mark hangs none: the row's card names the agent. */}
              <span className="inbox-row-mark">
                <ItemMark
                  holder={holder}
                  agentId={item.agentId}
                  models={models}
                  readerId={readerId}
                  plain
                />
              </span>
            </>
          }
          title={title}
          description={
            line ? (
              <span className="inbox-row-line" data-line={lineKind}>
                {lineGlyph(lineKind)}
                {preview}
              </span>
            ) : undefined
          }
          lead={
            line && chip
              ? { icon: <HolderGlyph holder={holder} />, label: holderName(holder) }
              : undefined
          }
          attachments={
            !line || media === undefined || carried.length === 0 ? undefined : (
              <RowMedia media={carried} reads={media} />
            )
          }
          meta={
            <span className="home-row-meta">
              {unread ? <VisuallyHidden>{UNREAD}</VisuallyHidden> : null}
              {context === undefined ? null : (
                <FadingWords className="home-row-context" words={context} />
              )}
              {starter === undefined || !face ? null : (
                <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />
              )}
              {starter === undefined || item.status !== INBOX_STATUS.OPEN ? null : (
                <VisuallyHidden>{waitingOn(starter)}</VisuallyHidden>
              )}
              {drafted ? <DraftMark /> : null}
              {needsYou ? (
                <span className="inbox-row-attention">
                  <AttentionMark />
                  <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
                </span>
              ) : null}
              <TaskStatusChip holder={holder} />
              <Time at={item.updatedAt} now={now} hint={false} />
            </span>
          }
          metaAt={LIST_ROW_META.TITLE}
          actions={
            read === undefined && close.action === undefined ? undefined : (
              <>
                {read === undefined ? null : (
                  <Tooltip label={read.label} command={read.command}>
                    <IconButton
                      icon={unread ? <MailOpenIcon /> : <MailIcon />}
                      label={read.label}
                      size={BUTTON_SIZE.COMPACT}
                      onClick={read.onSelect}
                    />
                  </Tooltip>
                )}
                {close.action === undefined ? null : (
                  <Tooltip label={close.action.label}>
                    <IconButton
                      icon={close.action.icon}
                      label={close.action.label}
                      size={BUTTON_SIZE.COMPACT}
                      onClick={close.action.onSelect}
                    />
                  </Tooltip>
                )}
              </>
            )
          }
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          swipe={
            onMark === undefined
              ? undefined
              : {
                  label: unread ? SWIPE_WORDS.READ : SWIPE_WORDS.UNREAD,
                  icon: unread ? <MailOpenIcon /> : <MailIcon />,
                  onAct: () => onMark(listed, !unread),
                }
          }
          current={chosen ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          muted={muted}
          hint={{ Hint: RowHint, label: title }}
          onPress={() => onChoose(listed)}
          contextMenu={groups.length === 0 ? undefined : menu.contextMenu(press)}
        />
      </RowHintOptions>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu label={ITEM_ACTIONS} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
      {close.dialog}
    </>
  );
}

/**
 * An item's task's status as its row wears it before its time: the
 * status's mark alone, small and quiet, as the task's sidebar row wears
 * it, so a Done task's item reads ✓ and a Canceled one's ×, its words said
 * to a reader and in the row's card (`HolderLine`). Note that it is drawn
 * whatever the status, an item of a finished task staying listed until it
 * is read or answered, and none for an agent with no task, nor for a task
 * from a service before statuses.
 */
function TaskStatusChip({ holder }: { holder: InboxHolder }): React.JSX.Element | null {
  if (holder.kind !== INBOX_HOLDER.TASK || holder.task.status === undefined) return null;
  const { status } = holder.task;
  return (
    <span className="inbox-row-task-status" data-task-status={status}>
      <TaskStatusMark status={status} />
      <VisuallyHidden>{TASK_STATUS_WORDS[status]}</VisuallyHidden>
    </span>
  );
}

/**
 * A holder's glyph as a row's chip draws it: a task's status's mark, an
 * automation's clock tile, and the factory glyph for the agents no
 * automation names, as the holder's group header draws them.
 */
function HolderGlyph({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  if (holder.kind === INBOX_HOLDER.TASK) return <PlanGlyph status={holder.task.status} />;
  if (holder.automationId === null) return <FactoryIcon />;
  return (
    <ActorMark
      actor={
        known === undefined
          ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
          : automationActor(known.automation)
      }
    />
  );
}

/**
 * A holder's group header: a task's status's mark and name; an
 * automation's clock tile, wearing how its last run went and hanging its
 * card where the window reads the automation; and the factory glyph for the
 * agents no automation names, since that group names no one actor.
 * A press folds the group, as every group header's does.
 */
function HolderHeader({
  holder,
  folded,
  count,
  onToggle,
}: {
  holder: InboxHolder;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  const shared = { folded, count, noun: NEEDS_YOU.COUNT, steady: true, onToggle };
  if (holder.kind === INBOX_HOLDER.TASK) {
    return (
      <SidebarGroupHeader
        glyph={<PlanGlyph status={holder.task.status} />}
        name={holder.task.name}
        {...shared}
      />
    );
  }
  if (holder.automationId === null) {
    return (
      <SidebarGroupHeader
        glyph={<FactoryIcon aria-hidden="true" />}
        name={holder.name}
        {...shared}
      />
    );
  }
  const actor =
    known === undefined
      ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
      : automationActor(known.automation);
  return (
    <SidebarGroupHeader
      glyph={<ActorMark actor={actor} />}
      name={holder.name}
      card={known === undefined ? undefined : <AutomationCard {...known} />}
      {...shared}
    />
  );
}

/**
 * A status's group header: Needs you by the attention mark, Waiting on
 * others by the hourglass, and Answered by a check. A press folds the
 * group, as every group header's does.
 */
function StatusHeader({
  status,
  folded,
  count,
  onToggle,
}: {
  status: InboxStatusGroupKind;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const glyph =
    status === INBOX_STATUS_GROUP.NEEDS_YOU ? (
      <AttentionMark />
    ) : status === INBOX_STATUS_GROUP.WAITING ? (
      <HourglassIcon />
    ) : (
      <CircleCheckIcon />
    );
  return (
    <SidebarGroupHeader
      glyph={glyph}
      name={STATUS_WORDS[status]}
      folded={folded}
      count={count}
      noun={NEEDS_YOU.COUNT}
      steady
      onToggle={onToggle}
    />
  );
}

/**
 * A person's group header: their face and name, the reader's own as You, a
 * member who left on the quiet outline, as the sidebar's group by creator
 * heads its groups. A press folds the group, as every group header's does.
 */
function PersonHeader({
  person,
  readerId,
  folded,
  count,
  onToggle,
}: {
  person: InboxPerson | undefined;
  readerId: string | undefined;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const { members, former, readerId: known } = useMemberDirectory();
  const reader = known ?? readerId;
  const you = members?.find((each) => each.userId === reader);
  const actor: Actor =
    person !== undefined
      ? personActor(person, members, reader, former)
      : you !== undefined
        ? memberActor(you, reader)
        : { kind: ACTOR_KIND.PERSON, userId: reader ?? "", name: "", you: true };
  return (
    <SidebarGroupHeader
      glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
      name={actorName(actor)}
      folded={folded}
      count={count}
      noun={NEEDS_YOU.COUNT}
      steady
      onToggle={onToggle}
    />
  );
}

/** Whose's choices: Everyone, then Mine, then each teammate the workspace lists by face and name, the choice checked. */
function whoseEntries(
  whose: InboxWhose,
  onWhose: (whose: InboxWhose) => void,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuAction[] {
  const you = reader.readerId ?? readerId;
  const me = reader.members?.find((member) => member.userId === you);
  const others = (reader.members ?? []).filter((member) => member.userId !== you);
  return [
    {
      label: "Everyone",
      icon: <UsersIcon />,
      checked: whose.kind === INBOX_WHOSE.EVERYONE,
      onSelect: () => onWhose(EVERYONES),
    },
    {
      label: "Mine",
      icon:
        me === undefined ? (
          <UserIcon />
        ) : (
          <ActorMark actor={memberActor(me, you)} size={ACTOR_SIZE.INLINE} />
        ),
      checked: whose.kind === INBOX_WHOSE.MINE,
      onSelect: () => onWhose({ kind: INBOX_WHOSE.MINE }),
    },
    ...others.map((member) => ({
      label: member.name,
      icon: <ActorMark actor={memberActor(member, you)} size={ACTOR_SIZE.INLINE} />,
      checked: whose.kind === INBOX_WHOSE.PERSON && whose.userId === member.userId,
      onSelect: () =>
        onWhose({ kind: INBOX_WHOSE.PERSON, userId: member.userId, name: member.name }),
    })),
  ];
}

/**
 * The head's button that drops the view's menu: first the scopes the Inbox
 * offers, To do and All, the one shown checked;
 * then, on the window's Inbox, Group by and Sort, each a submenu with its
 * choice checked; Whose, Everyone, Mine, or a teammate by face and name;
 * Media previews; and Mark all as read at its foot.
 */
function ViewOptions({
  shown,
  show,
  choices,
  readerId,
  readAll,
}: {
  shown: boolean;
  show: InboxShowChoice;
  /** The window's Inbox's other choices; none on a task's own, whose menu offers its scopes alone. */
  choices: InboxViewChoices | undefined;
  readerId: string | undefined;
  readAll: InboxReadAll | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
  const scope: MenuEntry[] = INBOX_SCOPES.map((value) => ({
    ...SCOPE_WORDS[value],
    checked: show.show === value,
    onSelect: () => show.onShow(value),
  }));
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[
            scope,
            ...(choices === undefined ? [] : windowEntries(choices, reader, readerId)),
            readAll === undefined ? [] : markAllEntries(readAll),
          ].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** Mark all as read, as the view's menu offers it at its foot, pressable while anything is unread; Chat's view menu offers the same. */
export function markAllEntries(readAll: InboxReadAll): MenuEntry[] {
  return [
    {
      label: MARK_ALL_READ,
      icon: <CheckCheckIcon />,
      disabled: !readAll.unread,
      onSelect: readAll.onMarkAll,
    },
  ];
}

/** The window's Inbox's own groups of its view's menu, after its scopes: Group by and Sort, Whose, and Media previews. */
function windowEntries(
  choices: InboxViewChoices,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuEntry[][] {
  const groupBy = (label: string, icon: React.JSX.Element, value: InboxGrouping): MenuAction => ({
    label,
    icon,
    checked: choices.grouping === value,
    onSelect: () => choices.onGrouping(value),
  });
  const sortBy = (label: string, icon: React.JSX.Element, value: InboxSort): MenuAction => ({
    label,
    icon,
    checked: choices.sort === value,
    onSelect: () => choices.onSort(value),
  });
  const view: MenuEntry[] = [
    {
      label: GROUP_BY,
      icon: <ListIcon />,
      items: [
        groupBy("Task", <DocumentIcon />, INBOX_GROUPING.TASK),
        groupBy("Person", <UsersIcon />, INBOX_GROUPING.PERSON),
        groupBy("Status", <CircleDotIcon />, INBOX_GROUPING.STATUS),
        groupBy("None", <ListIcon />, INBOX_GROUPING.NONE),
      ],
    },
    {
      label: SORT_BY,
      icon: <ArrowDownNarrowWideIcon />,
      items: [
        sortBy("Latest first", <ClockArrowDownIcon />, INBOX_SORT.LATEST),
        sortBy("Oldest first", <ClockArrowUpIcon />, INBOX_SORT.OLDEST),
      ],
    },
  ];
  const whose: MenuEntry[] = [
    {
      label: WHOSE,
      icon: <UsersIcon />,
      items: whoseEntries(choices.whose, choices.onWhose, reader, readerId),
    },
  ];
  const looks: MenuEntry[] = [
    {
      label: SECOND_LINE,
      icon: <Rows2Icon />,
      checked: choices.secondLine,
      onSelect: () => choices.onSecondLine(!choices.secondLine),
    },
    {
      label: MEDIA_PREVIEWS,
      icon: <ImagesIcon />,
      checked: choices.mediaPreviews,
      onSelect: () => choices.onMediaPreviews(!choices.mediaPreviews),
    },
  ];
  return [view, whose, looks];
}

/**
 * The chip over the list while Whose leaves out anyone's items: Mine by the
 * reader's face, or the teammate's face and name, and a × that lists
 * everyone's again (`@luke/ui`'s removable filter chip, as the sidebar's
 * Created by stands over its tasks).
 */
function WhoseChip({
  whose,
  readerId,
}: {
  whose: InboxWhoseChoice;
  readerId: string | undefined;
}): React.JSX.Element | null {
  const { members, former, readerId: known } = useMemberDirectory();
  const reader = known ?? readerId;
  const chosen = whose.whose;
  if (chosen.kind === INBOX_WHOSE.EVERYONE) return null;
  const me = members?.find((member) => member.userId === reader);
  const actor: Actor | undefined =
    chosen.kind === INBOX_WHOSE.PERSON
      ? personActor(chosen, members, reader, former)
      : me === undefined
        ? undefined
        : memberActor(me, reader);
  return (
    <div className="inbox-tasks-chips">
      <Chip
        look={CHIP_LOOK.FILTER}
        removeLabel={CLEAR_WHOSE}
        onRemove={() => whose.onWhose(EVERYONES)}
      >
        {actor === undefined ? <UserIcon /> : <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
        <ChipName>
          {chosen.kind === INBOX_WHOSE.MINE
            ? "Mine"
            : actor === undefined
              ? chosen.name
              : actorName(actor)}
        </ChipName>
      </Chip>
    </div>
  );
}

/** What the list stands where its scope leaves out every item it holds: that nothing is there, and the press that shows the scope that holds something, which keeps the list standing where the Inbox shows one column. */
export function ShowEmpty({
  show,
  counts,
  whose,
  onList,
}: {
  show: InboxShowChoice;
  counts: InboxCounts;
  /** Whose items the window's Inbox lists, which offers everyone's again where no scope holds any of theirs; none on a task's own. */
  whose?: InboxWhoseChoice | undefined;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  const whoseNames =
    whose !== undefined && whose.whose.kind !== INBOX_WHOSE.EVERYONE ? whose : undefined;
  const line =
    show.show === INBOX_SHOW.ALL && whoseNames !== undefined
      ? NOTHING_THEIRS
      : SHOW_EMPTY[show.show];
  const instead = insteadOf(show.show, counts);
  const everyone = instead === undefined ? whoseNames : undefined;
  return (
    <EmptyState
      icon={<InboxIcon />}
      action={
        instead !== undefined
          ? {
              label: SHOW_INSTEAD[instead],
              onClick: () => {
                onList();
                show.onShow(instead);
              },
            }
          : everyone !== undefined
            ? {
                label: SHOW_EVERYONES,
                onClick: () => {
                  onList();
                  everyone.onWhose(EVERYONES);
                },
              }
            : undefined
      }
    >
      {line}
    </EmptyState>
  );
}

/**
 * The list while its items are first read: rows in an item's own row, a
 * block where its agent's tile, its title, its time, and the line under
 * them will stand, so the
 * items land where the blocks stood rather than a lone ring in the list's
 * corner. The rows open nothing and the region says what is being read. A
 * list whose rows name what each item is about, as Home's do, asks for a
 * block before each time where that name will stand, and a short list asks
 * for fewer rows than the five a whole Inbox stands.
 */
export function InboxListSkeleton({
  rows = SKELETON_ROWS.length,
  context = false,
  reading = READING_ITEMS,
  list = TAB_WORDS.INBOX,
}: {
  /** How many placeholder rows stand, at most five. */
  rows?: number;
  /** Whether each row holds a block for its context before its time, as an item row given a `context` draws it. */
  context?: boolean;
  /** What a reader hears is being read, where the list is another's than the Inbox's, as Chat's rail. */
  reading?: string;
  /** What the list is called, where it is another's than the Inbox's. */
  list?: string;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={reading}>
      <List label={list}>
        {SKELETON_ROWS.slice(0, rows).map(({ title, preview }) => (
          <ListRow
            key={title}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_MARK} />}
            title={<Skeleton width={title} />}
            description={<Skeleton width={preview} />}
            meta={
              context ? (
                <span className="home-row-meta">
                  <Skeleton width={SKELETON_CONTEXT} />
                  <Skeleton width={SKELETON_TIME} />
                </span>
              ) : (
                <Skeleton width={SKELETON_TIME} />
              )
            }
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/** The words naming the list's search, on its magnifier and its field alike. */
const SEARCH_INBOX = "Search inbox";

/**
 * The list's search as its head draws it: a magnifier beside the view's
 * menu, which a press opens into a field standing in the head's name, the
 * caret in it. The field narrows the list as it is typed in, standing open
 * while it holds words; Escape empties and folds it, and so does the focus
 * leaving it empty, the keyboard then handed back to the magnifier where
 * Escape folded it.
 */
function useListSearch(search: InboxSearchHead | undefined) {
  const [asked, setAsked] = useState(false);
  const open = search !== undefined && (asked || search.query !== "");
  const field = useRef<HTMLInputElement | null>(null);
  const magnifier = useRef<HTMLButtonElement | null>(null);
  const backToMagnifier = useRef(false);
  useEffect(() => {
    if (open) {
      field.current?.focus();
      return;
    }
    if (!backToMagnifier.current) return;
    backToMagnifier.current = false;
    magnifier.current?.focus();
  }, [open]);
  const fold = (handBack: boolean) => {
    backToMagnifier.current = handBack;
    search?.onQuery("");
    setAsked(false);
  };
  const button =
    search === undefined || open ? null : (
      <Tooltip label={SEARCH_INBOX}>
        <IconButton
          ref={magnifier}
          icon={<SearchIcon />}
          label={SEARCH_INBOX}
          onClick={() => setAsked(true)}
        />
      </Tooltip>
    );
  const fieldDrawn =
    search === undefined || !open ? null : (
      <search
        className="inbox-search"
        onBlur={(event) => {
          // Note that a press on the field's own clear moves the focus within it, which folds nothing.
          if (event.currentTarget.contains(event.relatedTarget)) return;
          if (search.query === "") fold(false);
        }}
      >
        <SearchField
          ref={field}
          label={SEARCH_INBOX}
          placeholder={SEARCH_INBOX}
          value={search.query}
          onChange={search.onQuery}
          onClear={() => search.onQuery("")}
          onEscape={() => fold(true)}
        />
      </search>
    );
  return { button, field: fieldDrawn };
}

/**
 * The list's head: the Inbox's name, the scope after it where that is not
 * To do, and the view's menu at the list's top right, which chooses the
 * scope and, on the window's Inbox, the rest of how it lists; a task's own
 * Inbox lists one task's items in one run, so its menu offers its scopes
 * alone. On the window's Inbox its heading and its button glide as the
 * sidebar folds, the name moving to the list's middle, clear of the
 * sidebar's toggle, and the button keeping to the list's edge. Where the
 * list offers a search, its magnifier stands before the menu, and its field
 * in the name's place while it is open (`useListSearch`), in the sidebar's
 * head as on the page.
 */
function ListHead({
  head,
  readerId,
  placement,
}: {
  head: InboxListHead;
  readerId: string | undefined;
  placement: InboxListPlacement;
}): React.JSX.Element {
  const { shown, show, view } = head;
  const title = inboxTitle(show.show);
  const search = useListSearch(head.search);
  const options = (
    <>
      {head.onCompose === undefined ? null : (
        <Tooltip label={NEW_THREAD}>
          <IconButton icon={<ComposeIcon />} label={NEW_THREAD} onClick={head.onCompose} />
        </Tooltip>
      )}
      {search.button}
      <ViewOptions
        shown={shown}
        show={show}
        choices={view?.choices}
        readerId={readerId}
        readAll={head.readAll}
      />
    </>
  );
  const sidebar = placement === INBOX_LIST_PLACEMENT.SIDEBAR;
  return (
    <>
      {/* In the sidebar the list is headed as the sidebar's own sections are, under its places, rather than as a page. */}
      {sidebar ? (
        // Note that the field stands in the name's place in one head, so View options stays mounted as the field gives way.
        <SidebarSectionHead name={title} field={search.field}>
          {options}
        </SidebarSectionHead>
      ) : (
        <header className="desktop-toolbar inbox-tasks-bar">
          <div className="desktop-toolbar-heading">
            {search.field ?? <h1 className="desktop-toolbar-title">{title}</h1>}
          </div>
          <div className="desktop-toolbar-actions">{options}</div>
        </header>
      )}
      {view === undefined ? null : <WhoseChip whose={view.choices} readerId={readerId} />}
    </>
  );
}

/** What a list its search left empty says, under its rows, on the window's Inbox and a task's own alike. */
export function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
  return <p className="sidebar-note">{`No items match “${searched.trim()}”.`}</p>;
}

/** What the list says where a task's read did not answer. */
const NOT_READ = "Some items could not be read.";

/** The words of the way on from an Inbox with nothing in it. */
const NEW_TASK_LABEL = "New task";

/**
 * The way on from an Inbox with nothing in it, where the window rests with
 * no task open (`resting-page.ts`): New task, opening its dialog, primary
 * because starting one is all there is to do from an Inbox with nothing to
 * answer. None where nothing can start.
 */
export function newTaskAction(onNewTask: (() => void) | undefined): EmptyStateAction | undefined {
  return onNewTask === undefined
    ? undefined
    : {
        label: NEW_TASK_LABEL,
        look: EMPTY_STATE_ACTION_LOOK.PRIMARY,
        icon: <ComposeIcon />,
        onClick: onNewTask,
      };
}

/** What stands under the list's rows: a read that did not answer, placeholder rows while nothing is read, the scope's empty state where it leaves out every item, or the empty line, the Inbox's empty state where the list stands alone. */
export function InboxListNote({
  failed,
  reading,
  empty,
  alone,
  filteredOut,
  counts,
  onList,
  onRetry,
  searched,
  onNewTask,
}: {
  failed: boolean;
  reading: boolean;
  empty: boolean;
  /** Whether the list stands alone, the Inbox too narrow for the pane beside it. */
  alone: boolean;
  /** Opens New task, the way on from the Inbox's empty state where the list stands alone; none where nothing can start. */
  onNewTask?: (() => void) | undefined;
  /** The scope shown and whose items, where they leave out every item the Inbox holds, for its empty state to show another. */
  filteredOut: InboxViewChoices | undefined;
  /** How many items each scope lists, for the empty state to offer one that lists something. */
  counts: InboxCounts;
  /** Asks for the list, so the scope its empty state shows leaves it standing. */
  onList: () => void;
  onRetry: () => void;
  /** The words the list's search narrows it by, where it narrows it, which an empty list says found nothing. */
  searched?: string | undefined;
}): React.JSX.Element | null {
  if (failed) {
    return (
      <div className="sidebar-note">
        <ErrorState onRetry={onRetry}>{NOT_READ}</ErrorState>
      </div>
    );
  }
  if (!empty) return null;
  if (reading) return <InboxListSkeleton />;
  if (searched !== undefined) return <SearchEmpty searched={searched} />;
  if (filteredOut !== undefined)
    return <ShowEmpty show={filteredOut} counts={counts} whose={filteredOut} onList={onList} />;
  // Note that the list standing alone is the whole Inbox, so it says so as the hidden pane would.
  if (alone) {
    return (
      <EmptyState icon={<InboxIcon />} action={newTaskAction(onNewTask)}>
        {NEEDS_YOU.NONE}
      </EmptyState>
    );
  }
  return <p className="sidebar-note">{NEEDS_YOU.NONE}</p>;
}

/** Where a list of the window's Inbox stands: a column of its own on the Inbox's page, or the sidebar, which the inbox-first sidebar makes it. */
export const INBOX_LIST_PLACEMENT = {
  PAGE: "page",
  SIDEBAR: "sidebar",
} as const;

export type InboxListPlacement = (typeof INBOX_LIST_PLACEMENT)[keyof typeof INBOX_LIST_PLACEMENT];

/** What the list's head offers: its scopes on every Inbox, and on the window's how it groups its items and which plans are folded. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  /** The scope the list shows, and the choice that shows another. */
  readonly show: InboxShowChoice;
  /** The window's Inbox's grouping and its plans' folds; none on a task's own, which lists one task's items in one run. */
  readonly view: { readonly choices: InboxViewChoices; readonly folds: InboxTaskFolds } | undefined;
  /** Mark all as read, in the view's menu, where the list marks its items. */
  readonly readAll?: InboxReadAll | undefined;
  /** The list's search, which its head's magnifier opens, on the window's Inbox and a task's own alike; none where the list offers none. */
  readonly search?: InboxSearchHead | undefined;
  /** Opens a New thread in the pane, from the head's compose button; none where the list offers none. */
  readonly onCompose?: (() => void) | undefined;
}

/** The words a list's search holds, and the change that narrows the list to them. */
interface InboxSearchHead {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}

/** Mark all as read as the view's menu offers it: whether any item is unread, filtered out or not, and the mark. */
interface InboxReadAll {
  readonly unread: boolean;
  readonly onMarkAll: () => void;
}

/** What the list wears to keep the keyboard: its element, and its handlers for focus arriving and leaving. */
interface RowFocus {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly onFocus: (event: React.FocusEvent) => void;
  readonly onBlur: () => void;
}

/**
 * Keeps the keyboard in the list when the row holding it is no longer
 * drawn, as To do leaves out an item answered on another Mac while its
 * row is focused: the keyboard goes to View options, the control that
 * chooses what the list leaves out, as it does from a row leaving the list
 * while it fades. Note that a removed row fires no blur, so the row last focused is
 * remembered and looked for after every render.
 */
function useRowFocusKept(rows: InboxRowPresses): RowFocus {
  const ref = useRef<HTMLElement | null>(null);
  const focusedRow = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const list = ref.current;
    const row = focusedRow.current;
    if (list === null || row === undefined || list.hidden) return;
    // Note that a row leaving, or one in a group leaving, is drawn on, out of reach, while it fades, so the keyboard still in it is in no row.
    if (rows.find(row)?.closest(LEAVING) === null) return;
    focusedRow.current = undefined;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.closest(LEAVING) === null) return;
    listHeadControl(list)?.focus();
  });
  return {
    ref,
    onFocus: (event) => {
      focusedRow.current = rows.itemOf(event.target);
    },
    onBlur: () => {
      focusedRow.current = undefined;
    },
  };
}

/** A group's key, by which it leaves the list (`inbox-row-motion.tsx`). */
function groupKey({ key }: { readonly key: string }): string {
  return key;
}

/** A run of rows, each drawn on after it is no longer listed until its exit has played (`inbox-row-motion.tsx`). */
function InboxRows({
  items,
  row,
}: {
  items: readonly InboxListed[];
  row: (listed: InboxListed, leave?: React.RefCallback<HTMLElement>) => React.ReactNode;
}): React.JSX.Element {
  const { drawn, leave } = useLeaving(items, (listed) => listed.item.id);
  return (
    <ul className="sidebar-tasks">
      {drawn.map(({ key, value, leaving }) => row(value, leaving ? leave(key) : undefined))}
    </ul>
  );
}

/** The list's groups, each drawn on after its last row took it out of the list until its exit has played. */
function InboxGroups<G>({
  groups,
  keyOf,
  group,
}: {
  groups: readonly G[];
  keyOf: (group: G) => string;
  group: (group: G, leave: React.RefCallback<HTMLElement> | undefined) => React.ReactNode;
}): React.JSX.Element {
  const { drawn, leave } = useLeaving(groups, keyOf);
  return (
    <>{drawn.map(({ key, value, leaving }) => group(value, leaving ? leave(key) : undefined))}</>
  );
}

/** The list: its head where it has one, then each task's or each person's group of rows, or every row in one run, or a line where nothing is listed. */
export function InboxList({
  view,
  chosen,
  head,
  note,
  models,
  readerId,
  columns,
  rows,
  placement = INBOX_LIST_PLACEMENT.PAGE,
  onChoose,
  onMark,
  onClose,
}: {
  view: InboxListView;
  /** The id of the item the pane shows. */
  chosen: string | undefined;
  /** The catalog as last read, which names each agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter, where a teammate's name theirs. */
  readerId: string | undefined;
  head: InboxListHead;
  /** What stands under the rows: the list's empty line, placeholder rows while it is read, or a read that did not answer. */
  note: React.ReactNode;
  /** Which of the Inbox's columns stand. */
  columns: InboxColumnsShown;
  /** Where each row's press is kept, by the item it opens. */
  rows: InboxRowPresses;
  /** Where the list stands: its own column on the Inbox's page, or the sidebar, which scrolls it with the rest and draws the chosen item's open beside it. */
  placement?: InboxListPlacement;
  onChoose: (listed: InboxListed) => void;
  /** Marks an item read or unread from its row; none where the rows offer no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
  /** Closes an open item without an answer from its row; none where the rows offer no close. */
  onClose?: InboxCloser | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [leaves] = useState<InboxLeaves>(() => ({ pending: [] }));
  // Note that only the window's Inbox shows its rows' media, as its view's menu chooses; a task's own shows none.
  // The reads hold the pictures of the items listed alone, and none while the rows show no media.
  const previews = head.view?.choices.mediaPreviews === true;
  const mediaReads = useRowMediaReads(
    previews ? listedItems(view).map(({ item }) => item.id) : NO_ITEMS,
  );
  const media = previews ? mediaReads : undefined;
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const sidebar = placement === INBOX_LIST_PLACEMENT.SIDEBAR;
  // Note that a row names its task wherever no task's header stands over it, and a teammate's face wherever no person's does.
  // A row whose item is done with is drawn gray, the chosen row kept on To do and every such row on All alike.
  // A row leaving the list hands itself to the list's motion rather than to the keyboard's rows (`inbox-row-motion.tsx`).
  const row = (listed: InboxListed, leave?: React.RefCallback<HTMLElement>) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      open={listed.item.id === chosen && (sidebar || columns === INBOX_COLUMNS.BOTH)}
      now={now}
      models={models}
      readerId={readerId}
      face={view.grouping !== INBOX_GROUPING.PERSON}
      chip={head.view !== undefined && view.grouping !== INBOX_GROUPING.TASK}
      line={head.view?.choices.secondLine !== false}
      muted={isDone(listed.item)}
      media={media}
      ref={leave ?? rows.hold(listed.item.id)}
      onChoose={onChoose}
      onMark={onMark}
      onClose={onClose}
    />
  );
  const needingYou = (items: readonly InboxListed[]) =>
    items.filter((listed) => needsYouOf(listed, view.readerId)).length;
  const statusSection = (
    { key, status, items }: InboxStatusGroup,
    leave: React.RefCallback<HTMLElement> | undefined,
  ) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} ref={leave} className="sidebar-repository">
        <StatusHeader
          status={status}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        />
        {folded ? null : <InboxRows items={items} row={row} />}
      </div>
    );
  };
  const personSection = (
    { key, person, items }: InboxPersonGroup,
    leave: React.RefCallback<HTMLElement> | undefined,
  ) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} ref={leave} className="sidebar-repository">
        <PersonHeader
          person={person}
          readerId={readerId}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        />
        {folded ? null : <InboxRows items={items} row={row} />}
      </div>
    );
  };
  // Note that each grouping draws its groups anew, keyed by it, so a group of one grouping never leaves into another's.
  const body = (
    <div ref={bodyRef} className="inbox-tasks-body">
      {view.grouping === INBOX_GROUPING.NONE ? (
        <InboxRows items={view.items} row={row} />
      ) : view.grouping === INBOX_GROUPING.PERSON ? (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={groupKey}
          group={personSection}
        />
      ) : view.grouping === INBOX_GROUPING.STATUS ? (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={groupKey}
          group={statusSection}
        />
      ) : (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={({ holder }) => holderKey(holder)}
          group={({ holder, items }, leave) => {
            const key = holderKey(holder);
            const folded = head.view?.folds.folded(key) ?? false;
            return (
              <div key={key} ref={leave} className="sidebar-repository">
                <HolderHeader
                  holder={holder}
                  folded={folded}
                  count={needingYou(items.map((item) => ({ holder, item })))}
                  onToggle={() => head.view?.folds.toggle(key)}
                />
                {folded ? null : (
                  <InboxRows items={items.map((item) => ({ holder, item }))} row={row} />
                )}
              </div>
            );
          }}
        />
      )}
      {note}
      {/* Note that the motion is drawn after the rows, so a row leaving has handed itself over by the time it plays. */}
      <InboxRowMotion root={bodyRef} leaves={leaves} change={view} />
    </div>
  );
  // Note that in the sidebar the list scrolls with the sidebar's own scroller, under its pins, and takes the sidebar's width.
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks"
      data-placement={placement}
      aria-label="Inbox items"
      hidden={!sidebar && columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      style={sidebar ? undefined : { width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} readerId={readerId} placement={placement} />
      <InboxLeavesProvider value={leaves}>
        {sidebar ? body : <ScrollArea fade={SCROLL_FADE.START}>{body}</ScrollArea>}
      </InboxLeavesProvider>
      {!sidebar && columns === INBOX_COLUMNS.BOTH ? <SidebarResizeEdge edge={edge} /> : null}
    </nav>
  );
}
