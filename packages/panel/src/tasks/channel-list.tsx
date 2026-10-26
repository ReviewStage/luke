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
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { needsYouNoun } from "../desktop/places-waiting.js";
import { CHANNEL_SECTIONS, type ChannelSectionLook, sectionChannels } from "./channels-model.js";

/**
 * channel-list.tsx -- a phone's list of a workspace's channels, the screen its bar's Channels opens, as Slack's Home lists them (STAG-547).
 *
 * The narrow room has no sidebar in sight to list the channels, so the
 * Inbox's place lists them itself across the screen before a channel's
 * stream stands there, as the Inbox's own list does before an item. Each
 * row is a channel's glyph, its name, its purpose after it, and at its end
 * how many open asks in it wait on the reader, in the attention's tone; the
 * standing channels come first and the projects' under their heading, each
 * in the service's order (`CHANNEL_SECTIONS`). A press opens the channel's
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

/** One channel's row. */
function ChannelListRow({
  channel,
  onOpen,
}: {
  channel: Channel;
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<GLYPH.CHANNEL />}
      detail={channel.purpose}
      count={{
        value: channel.waiting,
        noun: needsYouNoun(channel.waiting),
        tone: STATUS_TONE.ATTENTION,
      }}
      onClick={() => onOpen(channel.id)}
    >
      {channel.name}
    </NavItem>
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

/** The list; see the module's head. `channels` is none until first read, and `failed` whether that read failed. */
export function ChannelList({
  channels,
  failed,
  onOpen,
  onNew,
  onRetry,
}: {
  channels: readonly Channel[] | undefined;
  failed: boolean;
  onOpen: (channelId: string) => void;
  /** Asks for a channel to make. */
  onNew: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  if (channels === undefined && !failed) return <ChannelListSkeleton />;
  return (
    <ChannelListFrame onNew={channels === undefined ? undefined : onNew}>
      {channels === undefined ? (
        <ErrorState placement={ERROR_STATE_PLACEMENT.ROWS} onRetry={onRetry}>
          {CHANNELS_NOT_READ}
        </ErrorState>
      ) : (
        CHANNEL_SECTIONS.map((section) => {
          const rows = sectionChannels(channels, section);
          return section.project && rows.length === 0 ? null : (
            <ChannelListSection key={section.label} section={section}>
              <SidebarPlaces label={section.label}>
                {rows.map((channel) => (
                  <ChannelListRow key={channel.id} channel={channel} onOpen={onOpen} />
                ))}
              </SidebarPlaces>
            </ChannelListSection>
          );
        })
      )}
    </ChannelListFrame>
  );
}
