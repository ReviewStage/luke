import type { Channel } from "@luke/features/channel-wire";
import { channelPlace } from "@luke/features/link-grammar";
import { CONFIRM_LOSS, ConfirmDialog, useConfirmDialog } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { answered } from "../desktop/channel-dialog.js";
import { channelEditable, channelUnread } from "./channels-model.js";
import type { ChannelsControl } from "./use-channels.js";

/**
 * channel-menu.tsx -- a channel's menu, as its sidebar row's right-click and a phone's list's long press both offer it, and the question its Archive asks.
 *
 * The menu offers Copy link, the channel's own link (`channelPlace`); Mark
 * as read, which stamps the reader's look at it now and stands unavailable
 * while nothing in it is unread; and, on any channel but #general, which no
 * member renames or archives, Rename and Archive. Archiving asks first, in
 * the accent, since it can be undone but reaches everyone in the workspace
 * (`packages/panel/AGENTS.md`'s Confirms); the question goes with its
 * workspace, its channel, and its surface, and a refusal stands in the card.
 */

/** What a channel's menu says of each act. */
const CHANNEL_MENU_WORDS = {
  RENAME: "Rename…",
  ARCHIVE: "Archive…",
} as const;

/** A channel's menu as a surface holds it: each channel's groups, and the question to draw beside them. */
interface ChannelMenu {
  readonly groups: (channel: Channel) => MenuAction[][];
  readonly dialog: React.JSX.Element;
}

/** The menu of every channel a surface lists; `onRename` is where the surface asks for a new name, none where it asks for none. */
export function useChannelMenu({
  workspaceId,
  channels,
  shown,
  onRename,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** Whether the surface is in sight, which the question goes with. */
  shown: boolean;
  onRename: ((channel: Channel) => void) | undefined;
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
  );
  const groups = (channel: Channel): MenuAction[][] => {
    const copyLink = copyLinkItem(channelPlace(channel.id));
    const read: MenuAction = {
      ...commandAction(PANEL_COMMAND.MARK_READ, () => channels.onLook(channel.id), false),
      disabled: !channelUnread(channel),
    };
    const editable = channelEditable(channel);
    const manage: MenuAction[] = editable
      ? [
          ...(onRename === undefined
            ? []
            : [
                {
                  label: CHANNEL_MENU_WORDS.RENAME,
                  icon: <GLYPH.RENAME />,
                  onSelect: () => onRename(channel),
                },
              ]),
          {
            label: CHANNEL_MENU_WORDS.ARCHIVE,
            icon: <GLYPH.ARCHIVE />,
            onSelect: () => {
              setDoomed({ channel, workspaceId });
              archive.ask();
            },
          },
        ]
      : [];
    return [[...(copyLink === undefined ? [] : [copyLink]), read], manage].filter(
      (group) => group.length > 0,
    );
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
