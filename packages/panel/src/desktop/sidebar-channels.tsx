import type { Channel } from "@luke/features/channel-wire";
import { readingWords } from "@luke/features/words";
import {
  BUTTON_SIZE,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  MoreButton,
  NAV_COUNT_TONE,
  NAV_CURRENT,
  NavItem,
  NavItemSkeleton,
  SidebarFilters,
  SkeletonRegion,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useRef } from "react";
import { ChannelCard } from "../tasks/channel-card.js";
import { useChannelMenu } from "../tasks/channel-menu.js";
import { CHANNEL_SECTIONS, channelSections, channelUnread } from "../tasks/channels-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { useArchivedChannelsDialog } from "./archived-channels-dialog.js";
import { useChannelDialog } from "./channel-dialog.js";
import { groupCount } from "./sidebar-fold.js";

/**
 * sidebar-channels.tsx -- the channels under the sidebar's Inbox row while Channels is on, each a filter of the Inbox, and the questions that make, edit, and archive one (STAG-547).
 *
 * The rows stand in under the Inbox's name (`SidebarFilters`), the
 * workspace's standing channels first and its project channels after them,
 * as `channelSections` orders them. A row is the channel's glyph and name,
 * and at its end how many of its threads Needs you lists, in the unread dot's
 * blue; its name stands in the unread weight while something
 * was posted in it since the reader last looked (`channelUnread`). Resting
 * on a row hangs the channel's card beside it after the hint's wait, as
 * every other sidebar row's card hangs (`channel-card.tsx`). A press
 * narrows the Inbox to the channel, and its row is marked while it is. The
 * last row, Add channel, opens a menu that makes a channel or a project's,
 * and opens it once made, or lists the archived ones to open or unarchive
 * (`archived-channels-dialog.tsx`). While the channels are first read, a
 * few rows' blocks stand in their place (`SidebarChannelRowsSkeleton`), and
 * where that read failed, it says so with Retry. The ⋯ a hovered row wears,
 * and a right-click anywhere on it, offer the channel's menu
 * (`channel-menu.tsx`): Copy link, and Mark as read while it is unread;
 * Edit on every channel, #general's name staying as it is; and last and
 * alone, Archive on any but #general, which is never archived. Making and editing ask through
 * `channel-dialog.tsx`; archiving the channel shown moves the window to
 * #general (`use-channels.ts`). Every answer waits on the service, and a
 * refusal stands in the card until what was asked changes.
 */

/** What the rows say to a reader while the channels are read. */
const READING_CHANNELS = readingWords("channels");

/** What the rows say where the channels could not be read. */
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";

/** The group's name, which a reader hears for the rows under the Inbox. */
const CHANNELS_LABEL = "Channels";

/** The last row's words, whose menu makes a channel or opens an archived one. */
const ADD_CHANNEL = "Add channel";

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
  onOpen,
}: {
  channel: Channel;
  /** How many of the threads the Inbox counts live in it (`useChannelWaiting`). */
  waiting: number;
  workspaceId: string | undefined;
  current: boolean;
  shown: boolean;
  groups: MenuAction[][];
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
            tone: NAV_COUNT_TONE.UNREAD,
          }}
          contextMenu={menu.contextMenu(ellipsis)}
          actions={
            groups.length === 0 ? null : (
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
        <ActionMenu
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

/** The last row: Add channel, whose menu makes a channel or a project's, or lists either's archived ones. */
function AddChannelRow({
  shown,
  disabled,
  onNew,
  onArchived,
}: {
  shown: boolean;
  disabled: boolean;
  onNew: (project: boolean) => void;
  onArchived: (project: boolean) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const groups: MenuAction[][] = [
    CHANNEL_SECTIONS.map((section) => ({
      label: section.add,
      icon: <GLYPH.ADD />,
      onSelect: () => onNew(section.project),
    })),
    CHANNEL_SECTIONS.map((section) => ({
      label: section.browse,
      icon: <GLYPH.ARCHIVE />,
      onSelect: () => onArchived(section.project),
    })),
  ];
  return (
    <>
      <NavItem icon={<GLYPH.ADD />} menu={menu.trigger()} disabled={disabled}>
        {ADD_CHANNEL}
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={ADD_CHANNEL} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}

/** The channels under the Inbox row, the channel the Inbox is narrowed to marked. */
export function SidebarChannels({
  workspaceId,
  channels,
  waiting,
  currentId,
  shown,
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
  /** Narrows the Inbox to a channel, one just made among them. */
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const asking = useChannelDialog({ workspaceId, channels, shown, onMade: onOpen });
  const menu = useChannelMenu({ workspaceId, channels, shown, onEdit: asking.askEdit });
  const archived = useArchivedChannelsDialog({ workspaceId, channels, shown, onOpen });
  const listed = channels.channels;
  const sections = listed === undefined ? undefined : channelSections(listed);
  return (
    <SidebarFilters label={CHANNELS_LABEL}>
      {sections === undefined ? (
        channels.failed ? (
          <ErrorState placement={ERROR_STATE_PLACEMENT.ROWS} onRetry={channels.onRefresh}>
            {CHANNELS_NOT_READ}
          </ErrorState>
        ) : (
          <SidebarChannelRowsSkeleton />
        )
      ) : (
        [...sections.standing, ...sections.projects].map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            waiting={waiting.get(channel.id) ?? 0}
            workspaceId={workspaceId}
            current={channel.id === currentId}
            shown={shown}
            groups={menu.groups(channel)}
            onOpen={() => onOpen(channel.id)}
          />
        ))
      )}
      <AddChannelRow
        shown={shown}
        disabled={listed === undefined}
        onNew={asking.askNew}
        onArchived={archived.ask}
      />
      {asking.dialog}
      {menu.dialog}
      {archived.dialog}
    </SidebarFilters>
  );
}
