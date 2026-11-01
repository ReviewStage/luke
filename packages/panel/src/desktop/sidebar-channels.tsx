import type { Channel } from "@luke/features/channel-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { readFailedWords, readingWords } from "@luke/features/words";
import {
  BUTTON_SIZE,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  MoreButton,
  NAV_CURRENT,
  type NavFold,
  NavItem,
  NavItemSkeleton,
  SidebarFilters,
  SkeletonRegion,
  STATUS_TONE,
  Tooltip,
  useDisclosureFold,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { type ReactNode, useId, useRef } from "react";
import { unreadShown } from "../failure-report.js";
import { ChannelCard } from "../tasks/channel-card.js";
import { useChannelMenu } from "../tasks/channel-menu.js";
import { CHANNEL_SECTIONS, channelSections, channelUnread } from "../tasks/channels-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import type { MenuAction } from "./action-menu.js";
import { useArchivedChannelsDialog } from "./archived-channels-dialog.js";
import { useChannelDialog } from "./channel-dialog.js";
import { groupCount, sidebarFold } from "./sidebar-fold.js";
import { ReadAllMenu, type SidebarReadAll } from "./sidebar-read-all.js";

/**
 * sidebar-channels.tsx -- the channels under the sidebar's Inbox row while Channels is on, each a filter of the Inbox, and the questions that make, edit, and archive one (STAG-547).
 *
 * The rows stand in under the Inbox's name (`SidebarFilters`), the
 * workspace's standing channels first and its project channels after them,
 * as `channelSections` orders them. A row is the channel's glyph and name,
 * and at its end how many of its threads Needs you lists, in the needs-you
 * tone the Inbox's own count wears; its name stands in the unread weight while something
 * was posted in it since the reader last looked (`channelUnread`). Resting
 * on a row hangs the channel's card beside it after the hint's wait, as
 * every other sidebar row's card hangs (`channel-card.tsx`). A press
 * narrows the Inbox to the channel, and its row is marked while it is.
 *
 * The Inbox's own row heads them (`InboxChannels`). Its glyph gives way to a
 * chevron while it is hovered or holds the keyboard, as a repository's head
 * does, which folds the channels under it, the fold kept across launches
 * (`folded-groups.ts`); folded, the channel shown still stands under it, as
 * a fold leaves the open task standing. Its ⋯, which comes in beside its
 * chord while it is hovered, and a right-click anywhere on it, offer after
 * Mark all as read (`desktop-sidebar.tsx`) what makes a channel or a
 * project's, and opens it once made, and what lists the archived ones to
 * open or unarchive (`archived-channels-dialog.tsx`). While the channels are first read, a
 * few rows' blocks stand in their place (`SidebarChannelRowsSkeleton`), and
 * where that read failed, it says so with Retry. The ⋯ a hovered row wears,
 * and a right-click anywhere on it, offer the channel's menu
 * (`channel-menu.tsx`): Copy link, and Mark all as read, which stamps the
 * reader's look at it and marks its threads read, disabled while neither
 * is unread (`sidebar-read-all.tsx`); Edit on every channel, #general's name staying as it is; and last and
 * alone, Archive on any but #general, which is never archived. Making and editing ask through
 * `channel-dialog.tsx`; archiving the channel shown moves the window to
 * #general (`use-channels.ts`). Every answer waits on the service, and a
 * refusal stands in the card until what was asked changes.
 */

/** What the rows say to a reader while the channels are read. */
const READING_CHANNELS = readingWords("channels");

/** What the rows say where the channels could not be read. */
const CHANNELS_NOT_READ = readFailedWords("this workspace's channels");

/** The group's name, which a reader hears for the rows under the Inbox. */
const CHANNELS_LABEL = "Channels";

/** How wide each placeholder row's name stands while the channels are first read. */
const READING_ROWS = ["56%", "72%", "44%"] as const;

/** One channel's row: its glyph, its name, in the unread weight while something in it is unread, what waits on the reader in it, its card, and its menu. */
function ChannelRow({
  channel,
  waiting,
  workspaceId,
  current,
  shown,
  groups,
  readAll,
  onOpen,
}: {
  channel: Channel;
  /** How many of the threads the Inbox counts live in it (`useChannelWaiting`). */
  waiting: number;
  workspaceId: string | undefined;
  current: boolean;
  shown: boolean;
  /** Its menu's groups, Mark all as read among them where it is handed, and whether its threads are read. */
  groups: (markAll?: MenuAction, ready?: boolean) => MenuAction[][];
  readAll: SidebarReadAll;
  onOpen: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Tooltip
        label={channel.name}
        card={<ChannelCard channel={channel} workspaceId={workspaceId} />}
        cardBeside
      >
        <NavItem
          icon={<GLYPH.CHANNEL />}
          current={current ? NAV_CURRENT.PAGE : undefined}
          unread={channelUnread(channel)}
          count={{
            ...groupCount(waiting, NEEDS_YOU.COUNT),
            tone: STATUS_TONE.ATTENTION,
          }}
          contextMenu={menu.contextMenu(ellipsis)}
          actions={
            groups().length === 0 ? null : (
              <MoreButton
                ref={ellipsis}
                thing="Channel"
                size={BUTTON_SIZE.COMPACT}
                {...menu.trigger()}
              />
            )
          }
          onClick={onOpen}
        >
          {channel.name}
        </NavItem>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ReadAllMenu
          readAll={readAll}
          channelId={channel.id}
          label={`#${channel.name} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The rows while the channels are first read: a row's blocks for each, through the row's own box. */
function SidebarChannelRowsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_CHANNELS}>
      {READING_ROWS.map((width) => (
        <NavItemSkeleton key={width} icon={<GLYPH.CHANNEL />} width={width} />
      ))}
    </SkeletonRegion>
  );
}

/** What the Inbox's row is handed while it heads the channels: the fold's chevron, and what its menu offers of them after Mark all as read. */
export interface InboxChannels {
  readonly fold: NavFold;
  readonly groups: readonly (readonly MenuAction[])[];
}

/** What the Inbox's menu offers of the channels: what makes a channel or a project's, then what lists either's archived ones, each disabled while the channels are first read. */
function inboxGroups(
  reading: boolean,
  onNew: (project: boolean) => void,
  onArchived: (project: boolean) => void,
): MenuAction[][] {
  return [
    CHANNEL_SECTIONS.map((section) => ({
      label: section.add,
      icon: <GLYPH.ADD />,
      disabled: reading,
      onSelect: () => onNew(section.project),
    })),
    CHANNEL_SECTIONS.map((section) => ({
      label: section.browse,
      icon: <GLYPH.ARCHIVE />,
      disabled: reading,
      onSelect: () => onArchived(section.project),
    })),
  ];
}

/** The channels under the Inbox row, the channel the Inbox is narrowed to marked. */
export function SidebarChannels({
  workspaceId,
  channels,
  waiting,
  currentId,
  shown,
  readAll,
  folded,
  onFold,
  inbox,
  onOpen,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** How many of the threads the Inbox counts live in each channel, by channel (`useChannelWaiting`), so the rows add up to the Inbox's row. */
  waiting: ReadonlyMap<string, number>;
  /** The channel the Inbox is narrowed to, none while it lists every channel. */
  currentId: string | undefined;
  /** Whether the sidebar is in sight, which its menus and questions close with. */
  shown: boolean;
  /** What each channel's Mark all as read marks with. */
  readAll: SidebarReadAll;
  /** Whether the channels stand folded under the Inbox's row, and the press that folds or unfolds them. */
  folded: boolean;
  onFold: () => void;
  /** The Inbox's row, drawn heading the channels with what it is handed. */
  inbox: (channels: InboxChannels) => ReactNode;
  /** Narrows the Inbox to a channel, one just made among them. */
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const asking = useChannelDialog({ workspaceId, channels, shown, onMade: onOpen });
  const menu = useChannelMenu({ workspaceId, channels, shown, onEdit: asking.askEdit });
  const archived = useArchivedChannelsDialog({ workspaceId, channels, shown, onOpen });
  const fold = useDisclosureFold(true, sidebarFold(folded, onFold));
  const rowsId = useId();
  const listed = channels.channels;
  const sections = listed === undefined ? undefined : channelSections(listed);
  const row = (channel: Channel) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      waiting={waiting.get(channel.id) ?? 0}
      workspaceId={workspaceId}
      current={channel.id === currentId}
      shown={shown}
      groups={(markAll, ready) => menu.groups(channel, markAll, ready)}
      readAll={readAll}
      onOpen={() => onOpen(channel.id)}
    />
  );
  const shownChannel = listed?.find((channel) => channel.id === currentId);
  return (
    <>
      {inbox({
        fold: {
          state: fold.state,
          label: CHANNELS_LABEL,
          controls: fold.state.drawn ? rowsId : undefined,
        },
        groups: inboxGroups(listed === undefined, asking.askNew, archived.ask),
      })}
      <SidebarFilters
        label={CHANNELS_LABEL}
        fold={fold}
        id={rowsId}
        standing={shownChannel === undefined ? null : row(shownChannel)}
      >
        {sections === undefined ? (
          channels.failed ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.CHANNELS_READ)}
              placement={ERROR_STATE_PLACEMENT.ROWS}
              onRetry={channels.onRefresh}
            >
              {CHANNELS_NOT_READ}
            </ErrorState>
          ) : (
            <SidebarChannelRowsSkeleton />
          )
        ) : (
          [...sections.standing, ...sections.projects].map(row)
        )}
      </SidebarFilters>
      {asking.dialog}
      {menu.dialog}
      {archived.dialog}
    </>
  );
}
