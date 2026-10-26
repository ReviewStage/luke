import type { Channel } from "@luke/features/channel-wire";
import { readingWords } from "@luke/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
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
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import {
  CHANNEL_SECTIONS,
  type ChannelSectionLook,
  channelEditable,
  sectionChannels,
} from "../tasks/channels-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { ActionMenu } from "./action-menu.js";
import { answered, useChannelDialog } from "./channel-dialog.js";
import { needsYouNoun } from "./places-waiting.js";

/**
 * sidebar-channels.tsx -- the sidebar's Channels and Projects sections while Channels is on: every open channel of the workspace, and the questions that make, rename, and archive one (STAG-547).
 *
 * Each section heads its rows with a "+" that makes a channel there, a
 * project's under Projects, and opens it once made. A row is the channel's
 * glyph and name, and at its end how many open asks in it wait on the
 * reader, in the attention's tone; a press shows the channel in the Inbox's
 * place, and its row is marked while it stands there. While the channels are
 * first read, each section stands a few rows' blocks in its rows' place
 * (`SidebarChannelRowsSkeleton`), and where that read failed, the Channels
 * section says so with Retry. A right-click offers Rename and Archive on
 * any channel but #general, which no member may rename or archive; any
 * member may do either to every other. Making and renaming ask through
 * `channel-dialog.tsx`. Archiving asks first, in the accent, since it can
 * be undone but reaches everyone in the workspace
 * (`packages/panel/AGENTS.md`'s Confirms), and archiving the channel shown
 * moves the window to #general (`use-channels.ts`). Every answer waits on
 * the service, and a refusal stands in the card until what was asked
 * changes.
 */

/** What the sidebar's rows say to a reader while the channels are read. */
const READING_CHANNELS = readingWords("channels");

/** What the Channels section says where the channels could not be read. */
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";

/** One channel's row: its glyph, its name, what waits on the reader in it, and its menu. */
function ChannelRow({
  channel,
  current,
  shown,
  onOpen,
  onRename,
  onArchive,
}: {
  channel: Channel;
  current: boolean;
  shown: boolean;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const editable = channelEditable(channel);
  return (
    <>
      <NavItem
        icon={<GLYPH.CHANNEL />}
        current={current ? NAV_CURRENT.PAGE : undefined}
        count={{
          value: channel.waiting,
          noun: needsYouNoun(channel.waiting),
          tone: STATUS_TONE.ATTENTION,
        }}
        contextMenu={editable ? menu.contextMenu() : undefined}
        roving
        onClick={onOpen}
      >
        {channel.name}
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`#${channel.name} actions`}
          menu={menu.drawn}
          groups={[
            [
              { label: "Rename…", onSelect: onRename },
              { label: "Archive…", onSelect: onArchive },
            ],
          ]}
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
  const [archivedIn, setArchivedIn] = useState<string | undefined>(undefined);
  const [doomed, setDoomed] = useState<Channel | undefined>(undefined);
  const asking = useChannelDialog({ workspaceId, channels, shown, onMade: onOpen });
  const listed = channels.channels;
  const archive = useConfirmDialog(
    {
      // Note that the question stands while asked in the workspace listed, its channel still open there.
      subject:
        doomed !== undefined &&
        archivedIn === workspaceId &&
        (listed ?? []).some((each) => each.id === doomed.id),
      surfaceOpen: shown,
    },
    () =>
      doomed === undefined
        ? Promise.resolve(answered(undefined))
        : channels.onArchive(doomed.id).then(answered),
  );
  const askArchive = (channel: Channel) => {
    setArchivedIn(workspaceId);
    setDoomed(channel);
    archive.ask();
  };
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
            onOpen={() => onOpen(channel.id)}
            onRename={() => asking.askRename(channel)}
            onArchive={() => askArchive(channel)}
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
              <Tooltip label={section.add}>
                <IconButton
                  icon={<GLYPH.ADD />}
                  label={section.add}
                  disabled={listed === undefined}
                  onClick={() => asking.askNew(section.project)}
                />
              </Tooltip>
            }
          />
          {places(section)}
        </nav>
      ))}
      {asking.dialog}
      <ConfirmDialog
        open
        confirm={archive}
        question={{
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          title: "Archive channel?",
          body: `#${doomed?.name ?? ""} leaves the sidebar for everyone, and agents can no longer post to it. Its threads stay where they are.`,
          verb: "Archive channel",
          running: "Archiving",
        }}
      />
    </>
  );
}
