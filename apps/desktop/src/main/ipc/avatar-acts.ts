/**
 * avatar-acts.ts -- Luke's avatar as the windows reach it: the panel's report, the video toggle, the voice window's feed, and the call window's view of the video.
 *
 * The panel runs the avatar's session, so it alone can say the avatar is
 * starting, live, or ended and why. The floating call window or the voice
 * window reporting it is refused: the voice window would mute Luke's direct
 * audio on a `LIVE` it was told by anything but the window playing the
 * avatar. The tile's Video off and Video on turn it off and on from either
 * window that draws it, the panel (the Call tab and its call card) and the
 * floating call window, and from no other. The feed is the voice window's
 * alone, and reaches the panel only while there is an avatar to lip-sync it.
 * The call window's view of the video is signalled between the two windows
 * that hold its ends and no other: the call window's offer reaches the panel
 * only while the avatar stands, and the panel's answer reaches only the call
 * window.
 */

import { ACT, ACT_KIND } from "@luke/host/acts";
import { AVATAR_STATUS, avatarStanding } from "@luke/voice/avatar";
import { AVATAR_VIEW_SIGNAL } from "@luke/voice/avatar-view";
import type { WebContents } from "electron";
import { ActRefused, type ActRows } from "../act-router";
import type { AppStateStore } from "../app-state";
import type { ReportHandlers } from "../bridge-host";
import type { AvatarLink } from "../services/avatar-link";
import type { CallWindow } from "../window/call-window";
import type { PanelManager } from "../window/panel-manager";

export interface AvatarActsDependencies {
  /** Where the report is weighed against the host's word and written. */
  avatar: AvatarLink;
  /** What the feed is relayed while; every window is told the avatar from it. */
  state: AppStateStore;
  panel: Pick<PanelManager, "feedAvatar" | "signalAvatarView" | "owns">;
  callWindow: Pick<CallWindow, "signalAvatarView" | "owns">;
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
    [ACT_KIND.AVATAR_REPORT]: (report, { panel }) => {
      if (!panel) throw new ActRefused({ message: ACT[ACT_KIND.AVATAR_REPORT].refusal });
      avatar.report(report);
    },
    [ACT_KIND.VOICE_SET_VIDEO]: ({ on }, { panel, call }) => {
      if (!panel && !call) throw new ActRefused({ message: ACT[ACT_KIND.VOICE_SET_VIDEO].refusal });
      return avatar.setVideo(on);
    },
  };
}

export function avatarReports({
  state,
  panel,
  callWindow,
  voiceOwns,
}: Omit<AvatarActsDependencies, "avatar">): Pick<
  ReportHandlers,
  "feedAvatar" | "signalAvatarView"
> {
  return {
    // Note that a chunk with no avatar to reach is dropped rather than held,
    // because it has expired by the time one could draw it.
    feedAvatar(context, feed) {
      if (!voiceOwns(context.sender)) return;
      const { status } = state.snapshot().voice.avatar;
      if (status !== AVATAR_STATUS.STARTING && status !== AVATAR_STATUS.LIVE) return;
      panel.feedAvatar(feed);
    },
    // Note that an offer is dropped while no avatar stands, because the
    // window offers again once its card draws the avatar live.
    signalAvatarView({ sender }, signal) {
      if (signal.kind === AVATAR_VIEW_SIGNAL.ANSWER) {
        if (panel.owns(sender)) callWindow.signalAvatarView(signal);
        return;
      }
      if (!callWindow.owns(sender)) return;
      const offer = signal.kind === AVATAR_VIEW_SIGNAL.OFFER;
      if (offer && !avatarStanding(state.snapshot().voice.avatar)) return;
      panel.signalAvatarView(signal);
    },
  };
}
