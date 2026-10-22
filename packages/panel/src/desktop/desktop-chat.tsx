import { CHANNEL_KIND, type ChatChannel } from "@luke/features/chat-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { MentionLines, MentionPlace } from "@luke/features/mention-link";
import { inPinOrder } from "@luke/features/pin-order";
import type { CodeRef } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ArchiveIcon,
  BackIcon,
  BUTTON_SIZE,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FoldingButton,
  type FoldingButtonHint,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  LIST_ROW_META,
  ListRow,
  PencilIcon,
  PlusIcon,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  ScrollArea,
  Tooltip,
  UnarchiveIcon,
  useMenu,
  VisuallyHidden,
} from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import {
  CHAT_PLACE,
  type ChatPlace,
  type ChatRailRow,
  type ChatTaskGrouping,
  chatIndex,
  chatRail,
  FOR_YOU,
} from "@luke/ui/chat-model";
import type { SkillOption } from "@luke/ui/skill-mention";
import { sectionTaskIds, workspaceSections } from "@luke/ui/task-sections-model";
import {
  AtSignIcon,
  HashIcon,
  MailOpenIcon,
  MessagesSquareIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, ActorStack, actorCard } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { AttentionMark } from "../attention-mark.js";
import { useColumnSplit } from "../column-split.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks.js";
import { MemberDirectory } from "../member-directory.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SpinnerRegion } from "../spinner.js";
import { AgentCard, lineSubject } from "../tasks/agent-ref.js";
import { useChatActor, useChatNames } from "../tasks/chat-actors.js";
import { channelTitle } from "../tasks/chat-channel-name.js";
import { ChatPane, type ChatTaskDoors } from "../tasks/chat-pane.js";
import type { InboxCodeDoors } from "../tasks/inbox-code-card.js";
import { VIEW_OPTIONS } from "../tasks/inbox-columns.js";
import { InboxListSkeleton, markAllEntries } from "../tasks/inbox-list.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { keptSkills } from "../tasks/repository-skills.js";
import type { SkillSource } from "../tasks/skill-picker.js";
import { agentEndMark, PlanGlyph } from "../tasks/tab-look.js";
import { tasklessMentions } from "../tasks/task-mentions.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { useMinute } from "../tasks/task-time.js";
import { useTaskStatus } from "../tasks/use-known-names.js";
import { useOpenLink, useOpenTask } from "../tasks/use-open-link.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { type ChannelDialogs, useChannelDialogs } from "./chat-channel-dialogs.js";
import { previewWords } from "./chat-preview.js";
import { SidebarResizeEdge } from "./desktop-sidebar.js";
import { INBOX_LIST_WIDTH, useChatListWidth } from "./folded-groups.js";
import { strandedHome } from "./move-task-dialog.js";
import { useNarrowFocus } from "./narrow-focus.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { SidebarGroupHeader } from "./sidebar-group-header.js";
import { TaskStatusMark, taskCardOf } from "./task-card.js";
import { EDGE_SIDE, useResizableEdge } from "./use-resizable-edge.js";

/**
 * desktop-chat.tsx -- the window's Chat: the workspace's channels and direct messages in a rail of their own, and For you or the channel chosen read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Chat row is
 * marked while it does, as the window's Inbox (`desktop-inbox.tsx`) does.
 * The rail is drawn from the sidebar's own pieces: For you at its head,
 * counting what needs the developer in the Inbox's words (`NEEDS_YOU`),
 * then the channels, the tasks', and the direct messages, each group under
 * the sidebar's own group header (`SidebarGroupHeader`), each row wearing
 * the Inbox's unread dot and the unread weight while anything in it is
 * unread (`chat-model.ts`). A direct message's row leads with the other
 * member's mark and is named by who it is with; a direct message between
 * two others draws both of its two, and an agent's wears its failed mark at
 * the row's end as its sidebar row does. Each row behaves as a
 * sidebar task's and an Inbox item's do: it hangs its card while the
 * pointer rests on it, a task's channel ends in its task's mark, and a
 * right-click, a hover button, or a swipe marks it read; each task group is
 * headed as the sidebar heads the same tasks, and a group's ⋯ marks every
 * place in it read. Its bar is a page's
 * toolbar, as the Inbox's list's is: Chat's title and its Experimental
 * tag, then View options (Show archived channels, which lists the archived
 * channels as the Inbox's Archived scope does, and Mark all as read), New
 * channel, and Send feedback; it stands from the first frame, over
 * placeholder rows while the chat is read. A press on a row shows its
 * place in the pane beside the rail (`chat-pane.tsx`), whose head ends on
 * the channel's menu, as an Inbox item's bar ends on the item's: Mark as
 * read and Copy link for every channel, Open task for a task's, and Edit
 * and Archive, or Bring back, for a topic. The agents are named from the
 * plans' summaries, the way the sidebar names them, from the lines the
 * chat read carries where those name more, and from a read of each agent
 * drawn past both (`useChatNames`). With nothing read, it says
 * so under Chat's glyph. Any row of the sidebar leaves it for the plan it
 * stood over; Escape does not, as it does not leave the Inbox, so a stray
 * press never loses the place being read. Chat narrower than the Inbox's
 * line, by its own width (`column-split.ts`) or a narrow room's, shows the
 * rail or the place, one at a time (`hiddenColumns`): Chat opens on its
 * rail, and a place chosen there, or shown from elsewhere, stands alone the
 * whole width, under a way back to the rail, which Back's chord and Escape
 * take as well, as the Inbox's item's does. K and J step to the place above
 * and below in the rail as drawn, stopping at its ends, and ⇧J to the next
 * channel holding anything unread, wrapping round, as the Inbox's keys step
 * through its items, the row they land on taking the keyboard where the
 * rail stands. For you, and any channel with an ask waiting on the reader,
 * wears the Inbox's attention mark; the blue dot is for the unread alone.
 *
 * It reads only what it draws of the window's tasks (`ChatSurface`), kept as
 * one value while none of it moves (`useChatSurface`), so a delivery that
 * moves anything else draws none of Chat. The rail is read once per chat,
 * names, and grouping, and each place's time counts the minute itself.
 */

/**
 * What Chat reads of the window's tasks, and nothing else: the chat's own
 * control, the tasks and workspaces it names, how the sidebar groups them,
 * the reader, the agents' models a card names, and the doors it opens a
 * task, an agent, and a file through.
 */
export type ChatSurface = Pick<
  TasksControl,
  | "chatView"
  | "tasks"
  | "workspace"
  | "workspaces"
  | "taskSections"
  | "me"
  | "repositories"
  | "onShowAgent"
  | "onSelect"
  | "onShowFile"
  | "shown"
> & { readonly agents: Pick<TasksControl["agents"], "models"> };

/** What Chat reads of the window's tasks, the one value while none of it moves, so Chat holds (`memo`) through a delivery that moves only the rest. */
export function useChatSurface(tasks: TasksControl): ChatSurface {
  const { chatView, workspace, workspaces, taskSections, me, repositories, shown } = tasks;
  const { onShowAgent, onSelect, onShowFile } = tasks;
  const listed = tasks.tasks;
  const { models } = tasks.agents;
  return useMemo(
    () => ({
      chatView,
      tasks: listed,
      workspace,
      workspaces,
      taskSections,
      me,
      repositories,
      onShowAgent,
      onSelect,
      onShowFile,
      shown,
      agents: { models },
    }),
    [
      chatView,
      listed,
      workspace,
      workspaces,
      taskSections,
      me,
      repositories,
      onShowAgent,
      onSelect,
      onShowFile,
      shown,
      models,
    ],
  );
}

/** The workspace a chip's link is written in, the chat's own; none while no workspace is listed. */
function mentionPlaceOf(workspace: ChatSurface["workspace"]): MentionPlace | undefined {
  if (workspace === undefined) return undefined;
  return { workspace: workspace.slug ?? workspace.id, repository: null };
}

/** What a press on a task's chip does with no opener at hand, as in a test of one surface: nothing. */
const OPEN_NOTHING = (): void => undefined;

/**
 * The doors of each task the window lists, by its id, that its channel's
 * messages read through: its code read through the task and opened in it,
 * as the window's Inbox opens an item's (`desktop-inbox.tsx`), and, where
 * `mentions` asks, its mentions and skills, so a file's chip and a
 * person's `/skill` open the file in its task and a GitHub link is read
 * against its repository. Note that the
 * mentions name no task, as a page no task holds does (`tasklessMentions`),
 * because the window holds no text of the plan here, and a section of it
 * would otherwise be drawn gone. The plan's Chat tab asks neither, since
 * the task's page it stands on hands its own.
 */
function useTaskDoors(
  tasks: ChatSurface,
  mentions: boolean,
): (taskId: string) => ChatTaskDoors | undefined {
  const { act } = useAct();
  const openTask = useOpenTask() ?? OPEN_NOTHING;
  // Note that a file is opened through the latest control, so the doors stand while the window's lists move.
  const latest = useRef(tasks);
  latest.current = tasks;
  const workspace = mentionPlaceOf(tasks.workspace)?.workspace;
  const { tasks: listed } = tasks;
  // Note that each task's skills are read once and kept while its repository and workspace stand, because a source made anew, as a change to any listed task would make it, reads them again and draws its chips as words until it lands.
  const skillSources = useRef(
    new Map<string, { repository: string; workspaceId: string; source: SkillSource }>(),
  );
  const doors = useMemo(() => {
    const held = new Map<string, ChatTaskDoors>();
    const kept = skillSources.current;
    const reading = new Set<string>();
    const skillSourceOf = (taskId: string, repository: string, workspaceId: string) => {
      reading.add(taskId);
      const standing = kept.get(taskId);
      if (standing?.repository === repository && standing.workspaceId === workspaceId) {
        return standing.source;
      }
      const source = keptSkills(() => act(ACT_KIND.TASKS_SKILLS, { planId: taskId }));
      kept.set(taskId, { repository, workspaceId, source });
      return source;
    };
    for (const task of listed) {
      const showFile = (ref: CodeRef, commit: string | undefined) =>
        latest.current.onShowFile(task.id, ref, commit);
      const code: InboxCodeDoors = {
        repository: task.repository,
        readFile: (window) => act(ACT_KIND.TASKS_FILE, { taskId: task.id, ...window }),
        onOpenFile: showFile,
      };
      if (!mentions || workspace === undefined) {
        held.set(task.id, { code });
        continue;
      }
      const { repository, workspaceId } = task;
      const taskless = tasklessMentions({ workspace, workspaceId, repository }, openTask);
      const onOpenFile = (path: string, lines: MentionLines | undefined) =>
        lines === undefined
          ? showFile({ path }, undefined)
          : showFile({ path, startLine: lines.startLine, endLine: lines.endLine }, lines.commit);
      // A skill's file opens in its task, as the task's page opens it.
      const skills =
        repository === null
          ? undefined
          : {
              source: skillSourceOf(task.id, repository, workspaceId),
              onOpen: (skill: SkillOption) => showFile({ path: skill.path }, undefined),
            };
      held.set(task.id, {
        code,
        mentions: { ...taskless, taskName: task.name, doors: { ...taskless.doors, onOpenFile } },
        skills,
      });
    }
    // A task no longer listed, or listed with no repository, lets its skills go, so a repository chosen again is read afresh.
    for (const taskId of kept.keys()) if (!reading.has(taskId)) kept.delete(taskId);
    return held;
  }, [listed, act, openTask, workspace, mentions]);
  return useCallback((taskId: string) => doors.get(taskId), [doors]);
}

/** What Chat is called: its toolbar's title, and the way back from a place to the rail in a narrow room. */
const CHAT_LIST = "Chat";

/** What a reader hears while the chat is read, under the rail's placeholder rows. */
const READING_CHAT = "Reading chat…";

/** What View options' toggle of the archived channels is called. */
const SHOW_ARCHIVED = "Show archived channels";

/** What a task channel's menu opens its task with. */
const OPEN_TASK = "Open task";

/**
 * The way back's pill, which says where it goes and names Back's chord
 * whether its word is folded away or not, as the Inbox's way back does.
 */
const BackHint: FoldingButtonHint = ({ children }) => (
  <Tooltip label="Back to chat" command={APP_COMMAND.BACK}>
    {children}
  </Tooltip>
);

/**
 * How the rail groups the tasks' channels: as the reader's sidebar groups
 * the tasks, the pinned first in the pins' order, then each of the
 * reader's sections in the listed workspace.
 */
function taskGrouping(
  listed: ChatSurface["tasks"],
  workspaceId: string | undefined,
  state: ChatSurface["taskSections"],
): ChatTaskGrouping {
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    (task) => ({ position: task.pinPosition, at: task.pinnedAt ?? 0 }),
  ).map((task) => task.id);
  const sections =
    workspaceId === undefined
      ? []
      : workspaceSections(state, workspaceId).map((section) => ({
          id: section.id,
          title: section.title,
          icon: section.icon,
          taskIds: sectionTaskIds(state, section.id),
        }));
  return { pinned, sections };
}

/** The room the place beside the rail keeps however wide the rail is dragged, as the Inbox's item keeps beside its list. */
const PANE_RESERVE = 560;

/** The rail's width as drawn: as dragged, but never so wide the place beside it has less than its room. */
function drawnWidth(width: number): string {
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

/** What a row's unread dot says to a screen reader, and what a group's count counts. */
const UNREAD_WORDS = "Unread";
const UNREAD_NOUN = { one: "unread", many: "unread" } as const;

/** What For you's row says under its name, in the Inbox's words. */
function needsYouWords(count: number): string {
  if (count === 0) return NEEDS_YOU.NONE;
  return `${count} ${count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`;
}

/** The keys of the rail's groups no task's group names. */
const RAIL_GROUP = {
  CHANNELS: "channels",
  ARCHIVED: "archived",
  DIRECT: "direct",
} as const;

/** Which of the rail's groups a group is among: the rail's own, or the tasks' as the sidebar groups them, each keyed apart. */
const RAIL_SPACE = {
  RAIL: "rail",
  TASKS: "tasks",
} as const;
type RailSpace = (typeof RAIL_SPACE)[keyof typeof RAIL_SPACE];

/** A group of the rail as drawn: which groups it is among, its key there, name, glyph, places, and whether it starts folded. */
interface RailGroupShown {
  readonly space: RailSpace;
  readonly key: string;
  readonly name: string;
  readonly glyph: React.ReactNode;
  readonly rows: readonly ChatRailRow[];
  readonly foldedAtFirst: boolean;
}

/** The rail's groups as drawn, in three runs: those before the tasks', the tasks', and those after. */
interface RailGroupsShown {
  readonly lead: readonly RailGroupShown[];
  readonly tasks: readonly RailGroupShown[];
  readonly trail: readonly RailGroupShown[];
}

/**
 * The rail's groups in order, as the sidebar's stand: the channels, the
 * tasks' as the sidebar groups the tasks, then the archived and the direct
 * messages, each run drawn as its own list so a key is only ever its own
 * group's. The archived stand while View options shows them, and otherwise
 * only the one shown, so a channel archived while it is read keeps its row.
 */
function railGroups(
  rail: ReturnType<typeof chatRail>,
  showArchived: boolean,
  current: (row: ChatRailRow) => boolean,
): RailGroupsShown {
  const held = (group: RailGroupShown) => group.rows.length > 0;
  return {
    lead: [
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.CHANNELS,
        name: "Channels",
        glyph: <HashIcon />,
        rows: rail.channels,
        foldedAtFirst: false,
      } satisfies RailGroupShown,
    ].filter(held),
    tasks: rail.tasks
      .map(
        (group): RailGroupShown => ({
          space: RAIL_SPACE.TASKS,
          key: group.key,
          name: group.title,
          // Note that Pinned and Tasks wear no glyph, and a section its own icon or none, as the sidebar heads them.
          glyph: sectionGlyph(group.icon),
          rows: group.rows,
          foldedAtFirst: false,
        }),
      )
      .filter(held),
    trail: [
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.ARCHIVED,
        name: "Archived",
        glyph: <ArchiveIcon />,
        rows: showArchived ? rail.archived : rail.archived.filter(current),
        foldedAtFirst: false,
      } satisfies RailGroupShown,
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.DIRECT,
        name: "Direct messages",
        glyph: <AtSignIcon />,
        rows: rail.direct,
        foldedAtFirst: false,
      } satisfies RailGroupShown,
    ].filter(held),
  };
}

/** Which of the rail's groups stand folded, for as long as Chat stands: each as it starts until toggled, the toggled kept apart for each space. */
function useRailFolds() {
  const [toggled, setToggled] = useState<Readonly<Record<RailSpace, ReadonlySet<string>>>>({
    [RAIL_SPACE.RAIL]: new Set(),
    [RAIL_SPACE.TASKS]: new Set(),
  });
  return {
    folded: (group: RailGroupShown) => group.foldedAtFirst !== toggled[group.space].has(group.key),
    toggle: (group: RailGroupShown) =>
      setToggled((was) => {
        const next = new Set(was[group.space]);
        if (!next.delete(group.key)) next.add(group.key);
        return { ...was, [group.space]: next };
      }),
  };
}

/** What the press that opens a topic channel is called. */
const NEW_CHANNEL = "New channel";

/** What the view says where no chat is read. */
const NO_CHAT = "Chat is not available yet.";

/** What the view says where the workspace's chat could not be read. */
const CHAT_FAILED = "The workspace's chat could not be read.";

/** Whether a row stands for the place shown. */
function shows(place: ChatPlace, row: ChatRailRow): boolean {
  return place.kind === CHAT_PLACE.CHANNEL && place.channelId === row.channel.id;
}

/** What a row's hover button and swipe that mark it read are called. */
const MARK_READ = "Mark as read";
const SWIPE_READ = "Read";

/** What the press on a group's header that marks every place in it read is called. */
const MARK_ALL_READ = "Mark all as read";

/**
 * The card a place's row hangs, as the sidebar and the Inbox hang the same
 * thing: a task's channel its task's, a direct message the other member's,
 * an agent's tab's card naming its task or a person's; none for a channel
 * of the workspace's own, whose row names it whole.
 */
function placeCard(
  tasks: ChatSurface,
  row: ChatRailRow,
  actorOf: (memberId: string) => Actor,
): React.ReactNode {
  const { channel, other } = row;
  if (channel.kind === CHANNEL_KIND.TASK) {
    const task = tasks.tasks.find((each) => each.id === channel.planId);
    return task === undefined ? undefined : <TaskCardNow tasks={tasks} task={task} />;
  }
  if (other?.member === undefined) return undefined;
  if (other.agent !== undefined) {
    const { models } = tasks.agents;
    const subject = lineSubject(other.agent, models, tasks.me);
    return <AgentCard subject={subject} models={models} foot={other.taskName} />;
  }
  return actorCard(actorOf(other.member.id));
}

/** A task's card, counted from the window's minute, which it alone reads while it hangs. */
function TaskCardNow({
  tasks,
  task,
}: {
  tasks: ChatSurface;
  task: ChatSurface["tasks"][number];
}): React.JSX.Element {
  return taskCardOf(tasks, task, useMinute());
}

/** A topic's actions, from its head's ⋯ or its row's menu: edit its name and purpose and archive it, or bring an archived one back. */
function topicActionGroups(channel: ChatChannel, dialogs: ChannelDialogs): MenuAction[][] {
  if (channel.archived) {
    return [
      [
        {
          label: "Bring back channel",
          icon: <UnarchiveIcon />,
          onSelect: () => dialogs.askArchive(channel),
        },
      ],
    ];
  }
  return [
    [{ label: "Edit channel", icon: <PencilIcon />, onSelect: () => dialogs.askEdit(channel) }],
    [
      {
        label: "Archive channel",
        icon: <ArchiveIcon />,
        onSelect: () => dialogs.askArchive(channel),
      },
    ],
  ];
}

/** One channel's or direct message's row: its glyph or the other member's mark, its name, what it says after, its count, its card, and its menu. */
function RailRow({
  tasks,
  row,
  current,
  actorOf,
  dialogs,
  shown,
  onRead,
  onChoose,
}: {
  tasks: ChatSurface;
  row: ChatRailRow;
  current: boolean;
  actorOf: (memberId: string) => Actor;
  dialogs: ChannelDialogs;
  /** Whether Chat is on screen, which a menu does not outlive. */
  shown: boolean;
  onRead: (channelIds: readonly string[]) => void;
  onChoose: () => void;
}): React.JSX.Element {
  const other = row.other?.member;
  const { latest, channel } = row;
  // A direct message is named by who it is with, both of its two where the reader is neither (`channelLabel`).
  const title = row.label;
  const taskStatus = useTaskStatus(channel.planId);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.CHAT, channelId: channel.id });
  // A direct message between two others draws both of its two, as its name names both.
  const mark =
    row.between.length > 0 ? (
      <ActorStack actors={row.between.map(actorOf)} drawn={row.between.length} counted={false} />
    ) : other !== undefined ? (
      <ActorMark actor={actorOf(other.id)} size={ACTOR_SIZE.INLINE} />
    ) : channel.kind === CHANNEL_KIND.TASK ? (
      <PlanGlyph status={taskStatus} />
    ) : (
      <HashIcon />
    );
  const task =
    channel.kind === CHANNEL_KIND.TASK
      ? tasks.tasks.find((each) => each.id === channel.planId)
      : undefined;
  const said = latest === undefined ? "" : previewWords(latest);
  // Note that the service never moves a read back, so a row offers Mark as read alone, while something waits.
  const read = row.unread > 0 ? () => onRead([channel.id]) : undefined;
  const groups = [
    read === undefined ? [] : [markReadItem({ unread: true, onMark: read })],
    copyLink === undefined ? [] : [copyLink],
    ...(channel.kind === CHANNEL_KIND.TOPIC ? topicActionGroups(channel, dialogs) : []),
  ].filter((group) => group.length > 0);
  return (
    <PlaceRow
      mark={mark}
      title={title}
      preview={
        latest === undefined
          ? undefined
          : `${actorName(actorOf(latest.authorId))}${said === "" ? "" : `: ${said}`}`
      }
      at={latest?.postedAt}
      unread={row.unread > 0}
      needsYou={row.asks > 0}
      current={current}
      card={placeCard(tasks, row, actorOf)}
      end={
        task !== undefined ? (
          <TaskStatusMark task={task} stranded={strandedHome(tasks, task)} />
        ) : row.between.length > 0 || row.other?.agent === undefined ? undefined : (
          // An agent the reader writes with wears where it stands at the row's end, as its sidebar row does.
          agentEndMark(row.other.agent, false)
        )
      }
      groups={groups}
      shown={shown}
      onRead={read}
      onChoose={onChoose}
    />
  );
}

/**
 * One place of the rail as a row of the Inbox's own list (`ListRow`): the
 * blue dot in a gutter where something waits unread, its mark, its name in
 * the unread weight while it does, at the line's end the attention mark
 * where something in it needs the reader, as an Inbox item's needing them
 * wears it, what its row says there and when it last spoke, and under it
 * who said what last. It hangs its card, or its name alone, while the
 * pointer rests on it, a right-click opens its menu where it has one, and
 * while something waits unread in it, Mark as read stands at its end on
 * hover and a swipe right does it, as an Inbox row's do.
 */
function PlaceRow({
  mark,
  title,
  preview,
  at,
  unread,
  needsYou,
  current,
  card,
  end,
  groups,
  shown,
  onRead,
  onChoose,
}: {
  mark: React.ReactNode;
  title: string;
  preview: string | undefined;
  at: number | undefined;
  unread: boolean;
  needsYou: boolean;
  current: boolean;
  /** The card it hangs while the pointer rests on it; none hangs its name alone. */
  card: React.ReactNode;
  /** Said at the line's end before its time: a task's agent at work or its pull request, or a direct message's agent's failed mark. */
  end: React.ReactNode;
  /** Its menu's groups of actions, a right-click away; none opens no menu. */
  groups: readonly MenuAction[][];
  /** Whether Chat is on screen, which its menu does not outlive. */
  shown: boolean;
  /** Marks it read; none where nothing in it waits unread. */
  onRead: (() => void) | undefined;
  onChoose: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const press = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control, as a sidebar task's row does.
  const region = useRef<HTMLElement | null>(null);
  const hold = useCallback((element: HTMLElement | null) => {
    press.current = element;
    region.current = element?.parentElement ?? null;
  }, []);
  return (
    <>
      <RowHintOptions card={card} cardBeside cardRegion={region}>
        <ListRow
          ref={hold}
          leading={
            <>
              {/* Note that the gutter stands on every row, so the marks line up whether a row wears the dot or not. */}
              <span className="inbox-row-gutter">
                {unread ? <span className="inbox-row-unread" /> : null}
              </span>
              <span className="inbox-row-mark">{mark}</span>
            </>
          }
          title={title}
          description={preview}
          meta={
            <span className="home-row-meta">
              {unread ? <VisuallyHidden>{UNREAD_WORDS}</VisuallyHidden> : null}
              {needsYou ? (
                <span className="inbox-row-attention">
                  <AttentionMark />
                  <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
                </span>
              ) : null}
              {end}
              {at === undefined ? null : <RelativeTime at={at} hint={false} />}
            </span>
          }
          metaAt={LIST_ROW_META.TITLE}
          ink={LIST_ROW_INK.SIDEBAR}
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          menuOpen={menu.open !== undefined}
          hint={{ Hint: RowHint, label: title }}
          onPress={onChoose}
          contextMenu={groups.length === 0 ? undefined : menu.contextMenu(press)}
          actions={
            onRead === undefined ? undefined : (
              <Tooltip label={MARK_READ}>
                <IconButton
                  icon={<MailOpenIcon />}
                  label={MARK_READ}
                  size={BUTTON_SIZE.COMPACT}
                  onClick={onRead}
                />
              </Tooltip>
            )
          }
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          swipe={
            onRead === undefined
              ? undefined
              : { label: SWIPE_READ, icon: <MailOpenIcon />, onAct: onRead }
          }
        />
      </RowHintOptions>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu
          label={`${title} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * A group of the rail under the sidebar's own group header: its name,
 * folding, and how many of its places wait unread; folded, the place shown
 * stays in sight. Its ⋯, and a right-click on its header, offer Mark all
 * as read, as a sidebar section's head does.
 */
function RailGroup({
  name,
  glyph,
  rows,
  folded,
  shown,
  onToggle,
  onRead,
  row,
  current,
}: {
  name: string;
  glyph: React.ReactNode;
  rows: readonly ChatRailRow[];
  folded: boolean;
  /** Whether Chat is on screen, which its menu does not outlive. */
  shown: boolean;
  onToggle: () => void;
  onRead: (channelIds: readonly string[]) => void;
  row: (each: ChatRailRow) => React.JSX.Element;
  current: (each: ChatRailRow) => boolean;
}): React.JSX.Element {
  const drawn = folded ? rows.filter(current) : rows;
  const unread = rows.filter((each) => each.unread > 0);
  const menu = useMenu(shown);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const groups: MenuAction[][] = [
    [
      {
        label: MARK_ALL_READ,
        icon: <MailOpenIcon />,
        disabled: unread.length === 0,
        onSelect: () => onRead(unread.map((each) => each.channel.id)),
      },
    ],
  ];
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={glyph}
        name={name}
        folded={folded}
        count={unread.length}
        noun={UNREAD_NOUN}
        steady
        menuOpen={menu.open !== undefined}
        contextMenu={menu.contextMenu(ellipsis)}
        onToggle={onToggle}
        actions={
          <Tooltip label="Group actions">
            <IconButton
              ref={ellipsis}
              icon={<EllipsisIcon />}
              label={`Actions for ${name}`}
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
          </Tooltip>
        }
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${name} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {drawn.length === 0 ? null : <ul className="sidebar-tasks">{drawn.map(row)}</ul>}
    </div>
  );
}

/** Every place of the rail in its order, For you first, whether drawn or folded away. */
function railPlaces(groups: RailGroupsShown): readonly ChatRailRow[] {
  return [...groups.lead, ...groups.tasks, ...groups.trail].flatMap((group) => group.rows);
}

/** The places K and J step through: For you, then each row the rail draws, a folded group's place shown alone among its rows. */
function drawnSteps(
  groups: RailGroupsShown,
  folded: (group: RailGroupShown) => boolean,
  place: ChatPlace,
): readonly ChatPlace[] {
  const rows = [...groups.lead, ...groups.tasks, ...groups.trail].flatMap((group) =>
    folded(group) ? group.rows.filter((each) => shows(place, each)) : group.rows,
  );
  return [FOR_YOU, ...rows.map((each) => channelPlace(each))];
}

/** A row's channel as a place. */
function channelPlace(row: ChatRailRow): ChatPlace {
  return { kind: CHAT_PLACE.CHANNEL, channelId: row.channel.id };
}

/** Whether two places are the same one. */
function samePlace(one: ChatPlace, other: ChatPlace): boolean {
  if (one.kind !== CHAT_PLACE.CHANNEL || other.kind !== CHAT_PLACE.CHANNEL) {
    return one.kind === other.kind;
  }
  return one.channelId === other.channelId;
}

/** The next row after the place shown holding anything unread, wrapping round the rail, folded groups among it; none where no other does. */
function nextUnread(groups: RailGroupsShown, place: ChatPlace): ChatPlace | undefined {
  const rows = railPlaces(groups);
  const at = rows.findIndex((each) => shows(place, each));
  const after = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))];
  const found = after.find((each) => each.unread > 0 && !shows(place, each));
  return found === undefined ? undefined : channelPlace(found);
}

/**
 * K, J, and ⇧J while Chat is on screen: the place above or below the one
 * shown in the rail as drawn, stopping at its ends, and the next channel
 * holding anything unread. The row a key lands on takes the keyboard where
 * the rail stands, as the Inbox's row does, so the keys go on from there;
 * where the place stands alone, the narrow focus hands it on instead.
 */
function useChannelKeys({
  groups,
  folded,
  place,
  onChoose,
  active,
  railShown,
  rail,
}: {
  groups: RailGroupsShown | undefined;
  folded: (group: RailGroupShown) => boolean;
  place: ChatPlace;
  onChoose: (place: ChatPlace) => void;
  active: boolean;
  railShown: boolean;
  rail: React.RefObject<HTMLDivElement | null>;
}): void {
  const stepped = useRef(false);
  const steps = groups === undefined ? [] : drawnSteps(groups, folded, place);
  const at = steps.findIndex((each) => samePlace(each, place));
  const go = (to: ChatPlace | undefined) =>
    to === undefined
      ? undefined
      : () => {
          stepped.current = true;
          onChoose(to);
        };
  const previous = at > 0 ? steps[at - 1] : undefined;
  const next = at >= 0 ? steps[at + 1] : undefined;
  const unread = groups === undefined ? undefined : nextUnread(groups, place);
  useAppCommand(APP_COMMAND.PREVIOUS_CHAT_CHANNEL, active ? go(previous) : undefined);
  useAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL, active ? go(next) : undefined);
  useAppCommand(APP_COMMAND.NEXT_UNREAD_CHAT_CHANNEL, active ? go(unread) : undefined);
  // Note that the row is focused before paint, so the keyboard is never left on a row no longer marked.
  useLayoutEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    if (!railShown) return;
    rail.current
      ?.querySelector<HTMLElement>('.chat-rail [aria-current]:not([aria-current="false"])')
      ?.focus();
  });
}

/**
 * The window's Chat, in the plan's place: the rail, and the place chosen
 * beside it, inside the listed workspace's members read, as the Inbox
 * stands, so every member is drawn with their photo and card and a link
 * names its workspace.
 */
export const DesktopChat = memo(function DesktopChat(props: {
  tasks: ChatSurface;
  room: ShellRoom;
  accountName: string | undefined;
}): React.JSX.Element {
  const { tasks } = props;
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <ChatView {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});

/** The rail and the place chosen, read against the members around it. */
function ChatView({
  tasks,
  room,
  accountName,
}: {
  tasks: ChatSurface;
  room: ShellRoom;
  accountName: string | undefined;
}): React.JSX.Element {
  const view = tasks.chatView;
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useChatNames(listed, read, accountName);
  const dialogs = useChannelDialogs(tasks.workspace?.id, read?.answer, view.onChannel, view.open);
  const actorOf = useChatActor(read?.answer, names);
  const folds = useRailFolds();
  // Note that For you is where Chat opens, so its link is Chat's own.
  const copyChat = useCopyLinkItem()({ kind: LINK_PLACE.CHAT });
  const { width, onResize } = useChatListWidth();
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize chat list",
    onResize,
  });
  // Note that Chat narrower than the Inbox's line by its own width stands as a narrow room's does.
  const split = useColumnSplit();
  const single = room === SHELL_ROOM.NARROW || split.single === true;
  const chatRoom = single ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE;
  const { onSingle } = view;
  useLayoutEffect(() => {
    onSingle?.(split.single === true);
  }, [split.single, onSingle]);
  const screen = useNarrowFocus(chatRoom, view.listed);
  const measure = split.ref;
  const rootRef = useCallback(
    (element: HTMLDivElement | null) => {
      screen.current = element;
      const unmeasure = measure(element);
      return () => {
        screen.current = null;
        unmeasure?.();
      };
    },
    [screen, measure],
  );
  const hidden = hiddenColumns(chatRoom, view.listed);
  // A place standing alone steps back to the rail by Escape too, as the Inbox's item does.
  useAppCommand(APP_COMMAND.CHAT_LIST, hidden.list ? view.onList : undefined);
  const [showArchived, setShowArchived] = useState(false);
  const railWidth = single ? undefined : drawnWidth(width);
  const answer = read?.answer;
  const workspaceId = tasks.workspace?.id;
  const { taskSections } = tasks;
  const rail = useMemo(
    () =>
      answer === undefined
        ? undefined
        : chatRail(answer, names, taskGrouping(listed, workspaceId, taskSections)),
    [answer, names, listed, workspaceId, taskSections],
  );
  const groups =
    rail === undefined
      ? undefined
      : railGroups(rail, showArchived, (each) => shows(view.place, each));
  useChannelKeys({
    groups,
    folded: folds.folded,
    place: view.place,
    onChoose: view.onChoose,
    active: tasks.shown && read !== undefined && !view.failed,
    railShown: !hidden.list,
    rail: screen,
  });
  // Note that the window's Chat stands on no task's page, so a task's channel is handed its task's mentions here.
  const taskDoors = useTaskDoors(tasks, true);
  const mentionPlace = useMemo(() => mentionPlaceOf(tasks.workspace), [tasks.workspace]);
  const { onRead: readChannels, onList } = view;
  const { onSelect } = tasks;
  const channelActions = useCallback(
    (channel: ChatChannel) =>
      answer === undefined ? undefined : (
        <ChannelActions
          key={channel.id}
          channel={channel}
          title={channelTitle(answer, names, channel)}
          unread={(chatIndex(answer).unread.get(channel.id) ?? 0) > 0}
          dialogs={dialogs}
          shown={view.open}
          onMarkRead={() => readChannels([channel.id])}
          onOpenTask={onSelect}
        />
      ),
    [answer, names, dialogs, view.open, readChannels, onSelect],
  );
  const lead = useMemo(
    () =>
      single ? (
        <FoldingButton label={CHAT_LIST} icon={<BackIcon />} onClick={onList} hint={BackHint} />
      ) : undefined,
    [single, onList],
  );
  if (read === undefined || view.failed || rail === undefined || groups === undefined) {
    // Nothing read yet: a read that did not answer, one still out, or no chat to read at all.
    const standIn = view.failed ? (
      <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
        {CHAT_FAILED}
      </ErrorState>
    ) : view.available ? (
      <div className="chat-rail-body">
        <InboxListSkeleton reading={READING_CHAT} list={CHAT_LIST} />
      </div>
    ) : (
      <EmptyState icon={<MessagesSquareIcon />}>{NO_CHAT}</EmptyState>
    );
    return (
      <div className="chat-view">
        <nav className="chat-rail" aria-label={CHAT_LIST} style={{ width: railWidth }}>
          {/* Note that New channel stands but takes no press until the chat is read, since a channel opened against no chat would go nowhere. */}
          <RailBar onNew={undefined} viewOptions={undefined} />
          {standIn}
        </nav>
        {dialogs.dialog}
      </div>
    );
  }
  const chat = read.answer;
  const forYouGroups = copyChat === undefined ? [] : [[copyChat]];
  // Every place's row, archived or not, which the menus read what is unread from.
  const places = [
    ...rail.channels,
    ...rail.tasks.flatMap((each) => each.rows),
    ...rail.archived,
    ...rail.direct,
  ];
  const row = (each: ChatRailRow) => (
    <RailRow
      key={each.channel.id}
      tasks={tasks}
      row={each}
      current={shows(view.place, each)}
      actorOf={actorOf}
      dialogs={dialogs}
      shown={view.open}
      onRead={view.onRead}
      onChoose={() => view.onChoose({ kind: CHAT_PLACE.CHANNEL, channelId: each.channel.id })}
    />
  );
  const group = (shown: RailGroupShown) => (
    <RailGroup
      key={shown.key}
      name={shown.name}
      glyph={shown.glyph}
      rows={shown.rows}
      folded={folds.folded(shown)}
      shown={view.open}
      onToggle={() => folds.toggle(shown)}
      onRead={view.onRead}
      row={row}
      current={(each) => shows(view.place, each)}
    />
  );
  return (
    <div ref={rootRef} className="chat-view" data-single={String(single)}>
      <nav
        className="chat-rail"
        aria-label="Chat"
        hidden={hidden.list}
        style={{ width: railWidth }}
      >
        <RailBar
          onNew={dialogs.askNew}
          viewOptions={
            <ChatViewOptions
              shown={view.open}
              archived={showArchived}
              onArchived={setShowArchived}
              unread={places.some((each) => each.unread > 0)}
              onMarkAll={() =>
                view.onRead(places.flatMap((each) => (each.unread > 0 ? [each.channel.id] : [])))
              }
            />
          }
        />
        <ScrollArea fade={SCROLL_FADE.START}>
          <div className="chat-rail-body">
            <ul className="sidebar-tasks">
              <PlaceRow
                mark={<AtSignIcon />}
                title="For you"
                preview={needsYouWords(rail.forYou)}
                at={undefined}
                unread={false}
                needsYou={rail.forYou > 0}
                current={view.place.kind === CHAT_PLACE.FOR_YOU}
                card={undefined}
                end={undefined}
                groups={forYouGroups}
                shown={view.open}
                onRead={undefined}
                onChoose={() => view.onChoose(FOR_YOU)}
              />
            </ul>
            {groups.lead.map(group)}
            {groups.tasks.map(group)}
            {groups.trail.map(group)}
          </div>
        </ScrollArea>
        {single ? null : <SidebarResizeEdge edge={edge} />}
      </nav>
      <ChatPane
        chat={chat}
        names={names}
        place={view.place}
        mentionPlace={mentionPlace}
        tasks={listed}
        openLink={openLink}
        onPost={view.onPost}
        onAnswer={view.onAnswer}
        channelActions={channelActions}
        onOpen={view.onChoose}
        onBringBack={dialogs.askArchive}
        readPicture={view.readPicture}
        taskDoors={taskDoors}
        lead={lead}
        hidden={hidden.item}
      />
      {dialogs.dialog}
    </div>
  );
}

/** The rail's bar, a page's toolbar: Chat's title and its Experimental tag, then the view's menu where the chat is read, New channel, and Send feedback. */
function RailBar({
  onNew,
  viewOptions,
}: {
  /** Opens New channel's question; none while no chat is read, which leaves the press disabled. */
  onNew: (() => void) | undefined;
  viewOptions: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar chat-rail-bar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{CHAT_LIST}</h1>
        <ExperimentTag />
      </div>
      <div className="desktop-toolbar-actions">
        {viewOptions}
        <Tooltip label={NEW_CHANNEL}>
          <IconButton
            icon={<PlusIcon />}
            label={NEW_CHANNEL}
            disabled={onNew === undefined}
            onClick={onNew}
          />
        </Tooltip>
        <SendFeedbackButton experiment={EXPERIMENT.CHAT} />
      </div>
    </header>
  );
}

/** The rail's view menu, as the Inbox's list offers its own: Show archived channels, checked while they stand, and Mark all as read at its foot. */
function ChatViewOptions({
  shown,
  archived,
  onArchived,
  unread,
  onMarkAll,
}: {
  shown: boolean;
  archived: boolean;
  onArchived: (archived: boolean) => void;
  unread: boolean;
  onMarkAll: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
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
            [
              {
                label: SHOW_ARCHIVED,
                icon: <ArchiveIcon />,
                checked: archived,
                onSelect: () => onArchived(!archived),
              },
            ],
            markAllEntries({ unread, onMarkAll }),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * A channel's menu at its head's end, as an Inbox item's bar ends on the
 * item's: Mark as read while anything in it is unread, and Copy link, for
 * every channel; Open task for a task's; and for a topic, Edit and Archive,
 * or Bring back once archived.
 */
function ChannelActions({
  channel,
  title,
  unread,
  dialogs,
  shown,
  onMarkRead,
  onOpenTask,
}: {
  channel: ChatChannel;
  /** The channel's name in words, which the menu is named by. */
  title: string;
  unread: boolean;
  dialogs: ChannelDialogs;
  shown: boolean;
  onMarkRead: () => void;
  onOpenTask: (taskId: string) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.CHAT, channelId: channel.id });
  const taskStatus = useTaskStatus(channel.planId);
  const label = `${title} actions`;
  const read: MenuAction = {
    ...markReadItem({ unread: true, onMark: onMarkRead }),
    disabled: !unread,
  };
  const { planId } = channel;
  const own: MenuAction[][] =
    channel.kind === CHANNEL_KIND.TOPIC
      ? topicActionGroups(channel, dialogs)
      : channel.kind === CHANNEL_KIND.TASK && planId !== undefined
        ? [
            [
              {
                label: OPEN_TASK,
                icon: <PlanGlyph status={taskStatus} />,
                onSelect: () => onOpenTask(planId),
              },
            ],
          ]
        : [];
  const groups = [[read], copyLink === undefined ? [] : [copyLink], ...own].filter(
    (group) => group.length > 0,
  );
  return (
    <>
      <Tooltip label="Channel actions">
        <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}

/** What the plan's Chat tab says where its plan has no channel yet. */
const NO_TASK_CHANNEL = "Nothing is posted in this task's channel yet.";

/**
 * The plan's own Chat tab, in the plan's column: its channel of the
 * workspace's chat, at reading size, as the window's Chat shows it, its
 * composer posting there. A plan whose channel is not opened yet, which
 * its first post opens, says so; a chat not read yet waits on the read.
 */
export function TaskChatTab({
  tasks,
  taskId,
}: {
  tasks: ChatSurface;
  taskId: string;
}): React.JSX.Element {
  const view = tasks.chatView;
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useChatNames(listed, read, undefined);
  const taskDoors = useTaskDoors(tasks, false);
  const channel = read?.answer.channels.find(
    (each) => each.kind === CHANNEL_KIND.TASK && each.planId === taskId,
  );
  const channelId = channel?.id;
  const place = useMemo(
    (): ChatPlace => (channelId === undefined ? FOR_YOU : { kind: CHAT_PLACE.CHANNEL, channelId }),
    [channelId],
  );
  const mentionPlace = useMemo(() => mentionPlaceOf(tasks.workspace), [tasks.workspace]);
  if (read === undefined || channel === undefined) {
    return (
      <section className="chat-stream task-chat" aria-label="Chat">
        {view.failed ? (
          <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
            {CHAT_FAILED}
          </ErrorState>
        ) : read === undefined && view.available ? (
          <SpinnerRegion label="Loading chat" />
        ) : (
          <EmptyState icon={<MessagesSquareIcon />}>{NO_TASK_CHANNEL}</EmptyState>
        )}
      </section>
    );
  }
  return (
    <ChatPane
      chat={read.answer}
      names={names}
      place={place}
      mentionPlace={mentionPlace}
      tasks={listed}
      openLink={openLink}
      onPost={view.onPost}
      onAnswer={view.onAnswer}
      readPicture={view.readPicture}
      taskDoors={taskDoors}
    />
  );
}
