/**
 * avatar-acts.ts -- Luke's avatar as the windows reach it: the call window's report and video toggle, and the voice window's feed.
 *
 * The floating call window runs the avatar's session, so it alone can say the
 * avatar is starting, live, or ended and why, and it alone draws the tile
 * whose Video off and Restart video turn it off and on. A panel or the voice
 * window reporting it is refused: the voice window would mute Luke's direct
 * audio on a `LIVE` it was told by anything but the window drawing the video.
 * The feed is the voice window's alone, and reaches the call window only
 * while there is an avatar to lip-sync it.
 */

import type { WebContents } from "electron";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { AVATAR_STATUS } from "#shared/messages/avatar";
import { ActRefused, type ActRows } from "../act-router";
import type { AppStateStore } from "../app-state";
import type { ReportHandlers } from "../bridge-host";
import type { AvatarLink } from "../services/avatar-link";
import type { CallWindow } from "../window/call-window";

export interface AvatarActsDependencies {
  /** Where the report is weighed against the host's word and written. */
  avatar: AvatarLink;
  /** What the feed is relayed while; every window is told the avatar from it. */
  state: AppStateStore;
  callWindow: Pick<CallWindow, "feedAvatar">;
  /** Whether a window's contents are the voice window's. */
  voiceOwns: (sender: WebContents) => boolean;
}

export function avatarActRows({
  avatar,
}: Pick<AvatarActsDependencies, "avatar">): Pick<
  ActRows,
  typeof ACT_KIND.AVATAR_REPORT | typeof ACT_KIND.VOICE_SET_VIDEO
> {
  return {
    [ACT_KIND.AVATAR_REPORT]: (report, { call }) => {
      if (!call) throw new ActRefused({ message: ACT[ACT_KIND.AVATAR_REPORT].refusal });
      avatar.report(report);
    },
    [ACT_KIND.VOICE_SET_VIDEO]: ({ on }, { call }) => {
      if (!call) throw new ActRefused({ message: ACT[ACT_KIND.VOICE_SET_VIDEO].refusal });
      return avatar.setVideo(on);
    },
  };
}

export function avatarReports({
  state,
  callWindow,
  voiceOwns,
}: Omit<AvatarActsDependencies, "avatar">): Pick<ReportHandlers, "feedAvatar"> {
  return {
    // Note that a chunk with no avatar to reach is dropped rather than held,
    // because it has expired by the time one could draw it.
    feedAvatar(context, feed) {
      if (!voiceOwns(context.sender)) return;
      const { status } = state.snapshot().voice.avatar;
      if (status !== AVATAR_STATUS.STARTING && status !== AVATAR_STATUS.LIVE) return;
      callWindow.feedAvatar(feed);
    },
  };
}
