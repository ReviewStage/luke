import type { Channel } from "@luke/features/channel-wire";
import { readingWords } from "@luke/features/words";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  NAV_CURRENT,
  NavItem,
  NavItemSkeleton,
  SidebarPlaces,
  SkeletonRegion,
  STATUS_TONE,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useChannelMenu } from "../tasks/channel-menu.js";
import {
  CHANNEL_SECTIONS,
  type ChannelSectionLook,
  channelUnread,
  sectionChannels,
} from "../tasks/channels-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { useArchivedChannelsDialog } from "./archived-channels-dialog.js";
import { useChannelDialog } from "./channel-dialog.js";
import { needsYouNoun } from "./places-waiting.js";

/**
 * sidebar-channels.tsx -- the sidebar's Channels and Projects sections while Channels is on: every open channel of the workspace, and the questions that make, edit, and archive one (STAG-547).
 *
 * Each section heads its rows with a "+" that makes a channel there, a
 * project's under Projects, and opens it once made, and beside it Browse
 * archived channels, which lists the section's archived channels to open or
 * unarchive (`archived-channels-dialog.tsx`). A row is the channel's glyph
 * and name, and at its end how many open asks in it wait on the reader, in
 * the attention's tone; its name stands in the unread weight while
 * something was posted in it since the reader last looked
 * (`channelUnread`). A press shows the channel in the Inbox's place, and
 * its row is marked while it stands there. While the channels are first
 * read, each section stands a few rows' blocks in its rows' place
 * (`SidebarChannelRowsSkeleton`), and where that read failed, the Channels
 * section says so with Retry. A right-click, or the menu key or ⇧F10 on
 * the row, offers the channel's menu (`channel-menu.tsx`): Copy link, Mark as read, and Edit on every channel,
 * #general's name staying as it is, and Archive on any but #general, which
 * is never archived. Making and editing ask through `channel-dialog.tsx`; archiving
 * the channel shown moves the window to #general (`use-channels.ts`).
 * Every answer waits on the service, and a refusal stands in the card
 * until what was asked changes.
 */

/** What the sidebar's rows say to a reader while the channels are read. */
const READING_CHANNELS = readingWords("channels");

/** What the Channels section says where the channels could not be read. */
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";

/** What each section's head offers beside its "+", which opens the section's archived channels. */
const BROWSE_ARCHIVED = "Browse archived channels";

/** One channel's row: its glyph, its name, in the unread weight while something in it is unread, what waits on the reader in it, and its menu. */
function ChannelRow({
  channel,
  current,
  shown,
  groups,
  onOpen,
}: {
  channel: Channel;
  current: boolean;
  shown: boolean;
  groups: MenuAction[][];
  onOpen: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  return (
    <>
      <NavItem
        icon={<GLYPH.CHANNEL />}
        current={current ? NAV_CURRENT.PAGE : undefined}
        unread={channelUnread(channel)}
        count={{
          value: channel.waiting,
          noun: needsYouNoun(channel.waiting),
          tone: STATUS_TONE.ATTENTION,
        }}
        contextMenu={menu.contextMenu()}
        onKeyDown={menu.keyMenu}
        roving
        onClick={onOpen}
      >
        {channel.name}
      </NavItem>
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

/** One section's rows while the channels are first read: a row's blocks for each the section declares, through the row's own box. */
export function SidebarChannelRowsSkeleton({
  section,
}: {
  section: ChannelSectionLook;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_CHANNELS}>
      <SidebarPlaces>
        {section.reading.map((width) => (
          <NavItemSkeleton key={width} icon={<GLYPH.CHANNEL />} width={width} />
        ))}
      </SidebarPlaces>
    </SkeletonRegion>
  );
}

/** The sidebar's Channels and Projects sections, the channel shown marked where the Inbox's place shows one. */
export function SidebarChannels({
  workspaceId,
  channels,
  currentId,
  shown,
  onOpen,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** The channel the Inbox's place shows, none while it shows none. */
  currentId: string | undefined;
  /** Whether the sidebar is in sight, which its menus and questions close with. */
  shown: boolean;
  /** Shows a channel, one just made among them. */
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const asking = useChannelDialog({ workspaceId, channels, shown, onMade: onOpen });
  const menu = useChannelMenu({ workspaceId, channels, shown, onEdit: asking.askEdit });
  const archived = useArchivedChannelsDialog({ workspaceId, channels, shown, onOpen });
  const listed = channels.channels;
  const places = (section: ChannelSectionLook) => {
    if (listed === undefined) {
      // Note that a failed first read is said once, under Channels, and Projects stands bare.
      if (!channels.failed) return <SidebarChannelRowsSkeleton section={section} />;
      return section.project ? null : (
        <ErrorState placement={ERROR_STATE_PLACEMENT.ROWS} onRetry={channels.onRefresh}>
          {CHANNELS_NOT_READ}
        </ErrorState>
      );
    }
    return (
      <SidebarPlaces>
        {sectionChannels(listed, section).map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            current={channel.id === currentId}
            shown={shown}
            groups={menu.groups(channel)}
            onOpen={() => onOpen(channel.id)}
          />
        ))}
      </SidebarPlaces>
    );
  };
  return (
    <>
      {CHANNEL_SECTIONS.map((section) => (
        <nav key={section.label} className="sidebar-group" aria-label={section.label}>
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            label={section.label}
            actionsShown={GROUP_ACTIONS.AT_REST}
            actions={
              <>
                <Tooltip label={BROWSE_ARCHIVED}>
                  <IconButton
                    icon={<GLYPH.ARCHIVE />}
                    label={BROWSE_ARCHIVED}
                    disabled={listed === undefined}
                    onClick={() => archived.ask(section.project)}
                  />
                </Tooltip>
                <Tooltip label={section.add}>
                  <IconButton
                    icon={<GLYPH.ADD />}
                    label={section.add}
                    disabled={listed === undefined}
                    onClick={() => asking.askNew(section.project)}
                  />
                </Tooltip>
              </>
            }
          />
          {places(section)}
        </nav>
      ))}
      {asking.dialog}
      {menu.dialog}
      {archived.dialog}
    </>
  );
}
