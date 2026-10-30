import type { Channel } from "@luke/features/channel-wire";
import { channelPlace } from "@luke/features/link-grammar";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { CONFIRM_LOSS, ConfirmDialog, useConfirmDialog } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { answered } from "../desktop/channel-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { channelEditable, channelUnread } from "./channels-model.js";
import type { ChannelsControl } from "./use-channels.js";

/**
 * channel-menu.tsx -- a channel's menu, as its sidebar row's ⋯, its right-click, and a phone's long press all offer it, and the question its Archive asks.
 *
 * The menu offers Copy link, the channel's own link (`channelPlace`); Mark
 * all as read where the surface hands it one (`sidebar-read-all.tsx`),
 * which stamps the reader's look at the channel now and marks its threads
 * read, pressable while either is unread, and else Mark as read, which
 * stamps the look alone and stands only while something in it is unread,
 * never dimmed; Edit, which asks for its name and
 * purpose, #general's purpose alone, since no member renames it; and, last
 * and alone, on any channel but #general, which is never archived, Archive.
 * No menu row ends in "…", even one that asks. Archiving asks first, in
 * the accent, since it can be undone but reaches everyone in the workspace
 * (`packages/panel/AGENTS.md`'s Confirms); the question goes with its
 * workspace, its channel, and its surface, and a refusal stands in the card.
 */

/** What a channel's menu says of each act. */
const CHANNEL_MENU_WORDS = {
  EDIT: "Edit",
  ARCHIVE: "Archive",
} as const;

/** A channel's menu as a surface holds it: each channel's groups, and the question to draw beside them. */
interface ChannelMenu {
  /** A channel's groups, `markAll` in Mark as read's place, stamping the reader's look too, where one is handed; pressable for the look alone only once its threads are `ready`. */
  readonly groups: (channel: Channel, markAll?: MenuAction, ready?: boolean) => MenuAction[][];
  readonly dialog: React.JSX.Element;
}

/** The menu of every channel a surface lists; `onEdit` is where the surface asks for a channel's name and purpose (`channel-dialog.tsx`). */
export function useChannelMenu({
  workspaceId,
  channels,
  shown,
  onEdit,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** Whether the surface is in sight, which the question goes with. */
  shown: boolean;
  onEdit: (channel: Channel) => void;
}): ChannelMenu {
  const copyLinkItem = useCopyLinkItem();
  const [doomed, setDoomed] = useState<{ channel: Channel; workspaceId: string | undefined }>();
  const listed = channels.channels ?? [];
  const archive = useConfirmDialog(
    {
      subject:
        doomed !== undefined &&
        doomed.workspaceId === workspaceId &&
        listed.some((each) => each.id === doomed.channel.id),
      surfaceOpen: shown,
    },
    () =>
      doomed === undefined
        ? Promise.resolve(answered(undefined))
        : channels.onArchive(doomed.channel.id).then(answered),
    confirmFailure(FAILURE_SURFACE.CHANNEL_ARCHIVE),
  );
  const groups = (channel: Channel, markAll?: MenuAction, ready = false): MenuAction[][] => {
    const copyLink = copyLinkItem(channelPlace(channel.id));
    const look = () => channels.onLook(channel.id);
    // Note that Mark all as read stands for Mark as read where it is handed, so the menu offers one way to read a channel, whose look is stamped with its threads.
    const read: MenuAction[] =
      markAll !== undefined
        ? [
            {
              ...markAll,
              // Note that the look alone keeps it pressable only once the threads are read, so it never clears the channel's mark over threads it could not mark.
              disabled: markAll.disabled === true && !(ready && channelUnread(channel)),
              onSelect: () => {
                look();
                markAll.onSelect();
              },
            },
          ]
        : channelUnread(channel)
          ? [commandAction(PANEL_COMMAND.MARK_READ, look, false)]
          : [];
    const edit: MenuAction = {
      label: CHANNEL_MENU_WORDS.EDIT,
      icon: <GLYPH.RENAME />,
      onSelect: () => onEdit(channel),
    };
    const archiveItem: MenuAction = {
      label: CHANNEL_MENU_WORDS.ARCHIVE,
      icon: <GLYPH.ARCHIVE />,
      onSelect: () => {
        setDoomed({ channel, workspaceId });
        archive.ask();
      },
    };
    return [
      [...(copyLink === undefined ? [] : [copyLink]), ...read],
      [edit],
      channelEditable(channel) ? [archiveItem] : [],
    ].filter((group) => group.length > 0);
  };
  return {
    groups,
    dialog: (
      <ConfirmDialog
        open
        confirm={archive}
        question={{
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          title: "Archive channel?",
          body: `#${doomed?.channel.name ?? ""} leaves the sidebar for everyone, and agents can no longer post to it. Its threads stay where they are.`,
          verb: "Archive channel",
          running: "Archiving",
        }}
      />
    ),
  };
}
