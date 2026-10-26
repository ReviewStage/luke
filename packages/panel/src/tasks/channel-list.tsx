import type { Channel } from "@luke/features/channel-wire";
import { readingWords } from "@luke/features/words";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  NavItem,
  NavItemSkeleton,
  SCROLL_FADE,
  ScrollArea,
  SidebarPlaces,
  SkeletonRegion,
  STATUS_TONE,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { needsYouNoun } from "../desktop/places-waiting.js";
import { useChannelMenu } from "./channel-menu.js";
import {
  CHANNEL_SECTIONS,
  type ChannelSectionLook,
  channelUnread,
  sectionChannels,
} from "./channels-model.js";
import type { ChannelsControl } from "./use-channels.js";

/**
 * channel-list.tsx -- a phone's list of a workspace's channels, the screen its bar's Channels opens, as Slack's Home lists them (STAG-547).
 *
 * The narrow room has no sidebar in sight to list the channels, so the
 * Inbox's place lists them itself across the screen before a channel's
 * stream stands there, as the Inbox's own list does before an item. Each
 * row is a channel's glyph, its name, its purpose after it, and at its end
 * how many open asks in it wait on the reader, in the attention's tone; the
 * standing channels come first and the projects' under their heading, each
 * in the service's order (`CHANNEL_SECTIONS`). A channel something was
 * posted in since the reader last looked stands in the unread weight, as
 * the sidebar's row does, and a long press, or the menu key or ⇧F10,
 * offers the same menu its row's right-click does (`channel-menu.tsx`). A press opens the channel's
 * stream, and the bar's "+" asks for a channel to make, as the sidebar's
 * does, opening it once made. While the channels are first read, each
 * section stands a few rows' blocks in its rows' place
 * (`ChannelListSkeleton`), and a read that failed says so with Retry.
 */

/** What the list's rows say to a reader while the channels are read. */
const READING_CHANNELS = readingWords("channels");

/** What the list says where the channels could not be read. */
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";

/** The standing channels' section, which makes a standing channel from the bar's "+". */
const STANDING = CHANNEL_SECTIONS[0];

/** One channel's row and its menu. */
function ChannelListRow({
  channel,
  shown,
  groups,
  onOpen,
}: {
  channel: Channel;
  shown: boolean;
  groups: MenuAction[][];
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  return (
    <>
      <NavItem
        icon={<GLYPH.CHANNEL />}
        detail={channel.purpose}
        unread={channelUnread(channel)}
        count={{
          value: channel.waiting,
          noun: needsYouNoun(channel.waiting),
          tone: STATUS_TONE.ATTENTION,
        }}
        contextMenu={menu.contextMenu()}
        onKeyDown={menu.keyMenu}
        onClick={() => onOpen(channel.id)}
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

/** One section: its heading, but the first's, which the bar's title names, over what stands in its rows' place. */
function ChannelListSection({
  section,
  children,
}: {
  section: ChannelSectionLook;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {section.project ? <GroupHeader heading={GROUP_HEADING.NONE} label={section.label} /> : null}
      {children}
    </>
  );
}

/** The list's screen: its bar, with the "+" where one is given, over its scrolling rows. */
function ChannelListFrame({
  onNew,
  children,
}: {
  onNew: (() => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="channel-list flex min-h-0 min-w-0 flex-col" aria-label="Channels">
      <Toolbar
        title="Channels"
        end={TOOLBAR_INSET.COLUMN}
        actions={
          <Tooltip label={STANDING.add}>
            <IconButton
              icon={<GLYPH.ADD />}
              label={STANDING.add}
              disabled={onNew === undefined}
              onClick={onNew}
            />
          </Tooltip>
        }
      />
      <ScrollArea fade={SCROLL_FADE.BOTH}>
        <div className="channel-list-body flex flex-col px-column-inset pt-luke-4 pb-luke-16">
          {children}
        </div>
      </ScrollArea>
    </section>
  );
}

/** The list while the channels are first read: each section a row's blocks for each it declares, through the row's own box, with no "+" yet. */
export function ChannelListSkeleton(): React.JSX.Element {
  return (
    <ChannelListFrame onNew={undefined}>
      <SkeletonRegion label={READING_CHANNELS}>
        {CHANNEL_SECTIONS.map((section) => (
          <ChannelListSection key={section.label} section={section}>
            <SidebarPlaces>
              {section.reading.map((width) => (
                <NavItemSkeleton key={width} icon={<GLYPH.CHANNEL />} width={width} />
              ))}
            </SidebarPlaces>
          </ChannelListSection>
        ))}
      </SkeletonRegion>
    </ChannelListFrame>
  );
}

/** The list; see the module's head. Its channels are none until first read, and `failed` says whether that read failed. */
export function ChannelList({
  workspaceId,
  channels: control,
  shown,
  onOpen,
  onNew,
  onEdit,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** Whether the list is in sight, which its menus and questions close with. */
  shown: boolean;
  onOpen: (channelId: string) => void;
  /** Asks for a channel to make. */
  onNew: () => void;
  /** Asks for a channel's name and purpose. */
  onEdit: (channel: Channel) => void;
}): React.JSX.Element {
  const menu = useChannelMenu({ workspaceId, channels: control, shown, onEdit });
  const { channels, failed } = control;
  if (channels === undefined && !failed) return <ChannelListSkeleton />;
  return (
    <ChannelListFrame onNew={channels === undefined ? undefined : onNew}>
      {channels === undefined ? (
        <ErrorState placement={ERROR_STATE_PLACEMENT.ROWS} onRetry={control.onRefresh}>
          {CHANNELS_NOT_READ}
        </ErrorState>
      ) : (
        CHANNEL_SECTIONS.map((section) => {
          const rows = sectionChannels(channels, section);
          return section.project && rows.length === 0 ? null : (
            <ChannelListSection key={section.label} section={section}>
              <SidebarPlaces label={section.label}>
                {rows.map((channel) => (
                  <ChannelListRow
                    key={channel.id}
                    channel={channel}
                    shown={shown}
                    groups={menu.groups(channel)}
                    onOpen={onOpen}
                  />
                ))}
              </SidebarPlaces>
            </ChannelListSection>
          );
        })
      )}
      {menu.dialog}
    </ChannelListFrame>
  );
}
