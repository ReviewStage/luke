import type { Channel } from "@luke/features/channel-wire";
import {
  GROUP_HEADING,
  GroupHeader,
  NavItem,
  SCROLL_FADE,
  ScrollArea,
  SidebarPlaces,
  STATUS_TONE,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { needsYouNoun } from "../desktop/places-waiting.js";
import { channelSections } from "./channels-model.js";

/**
 * channel-list.tsx -- a phone's list of a workspace's channels, the screen its bar's Channels opens, as Slack's Home lists them (STAG-547).
 *
 * The narrow room has no sidebar in sight to list the channels, so the
 * Inbox's place lists them itself across the screen before a channel's
 * stream stands there, as the Inbox's own list does before an item. Each
 * row is a channel's glyph, its name, its purpose after it, and at its end
 * how many open asks in it wait on the reader, in the attention's tone; the
 * standing channels come first and the projects' under their heading, each
 * in the service's order. A press opens the channel's stream.
 */

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

/** The list; see the module's head. */
export function ChannelList({
  channels,
  onOpen,
}: {
  channels: readonly Channel[];
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const { standing, projects } = channelSections(channels);
  return (
    <section className="channel-list flex min-h-0 min-w-0 flex-col" aria-label="Channels">
      <Toolbar title="Channels" end={TOOLBAR_INSET.COLUMN} />
      <ScrollArea fade={SCROLL_FADE.BOTH}>
        <div className="channel-list-body flex flex-col px-column-inset pt-luke-4 pb-luke-16">
          <SidebarPlaces label="Channels">
            {standing.map((channel) => (
              <ChannelListRow key={channel.id} channel={channel} onOpen={onOpen} />
            ))}
          </SidebarPlaces>
          {projects.length === 0 ? null : (
            <>
              <GroupHeader heading={GROUP_HEADING.NONE} label="Projects" />
              <SidebarPlaces label="Projects">
                {projects.map((channel) => (
                  <ChannelListRow key={channel.id} channel={channel} onOpen={onOpen} />
                ))}
              </SidebarPlaces>
            </>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
