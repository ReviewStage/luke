/**
 * avatar-acts.ts -- the call window's report of Luke's avatar, written into the document every window reads.
 *
 * The floating call window runs the avatar's session, so it alone can say the
 * avatar is starting, live, or ended and why. A panel or the voice window
 * reporting it is refused: the voice window would mute Luke's direct audio on
 * a `LIVE` it was told by anything but the window drawing the video.
 */

import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows } from "../act-router";
import type { AppStateStore } from "../app-state";

export interface AvatarActsDependencies {
  /** Where the report is written; every window is told from it. */
  state: AppStateStore;
}

export function avatarActRows({
  state,
}: AvatarActsDependencies): Pick<ActRows, typeof ACT_KIND.AVATAR_REPORT> {
  return {
    [ACT_KIND.AVATAR_REPORT]: (avatar, { call }) => {
      if (!call) throw new ActRefused({ message: ACT[ACT_KIND.AVATAR_REPORT].refusal });
      state.update({ voice: { ...state.snapshot().voice, avatar } });
    },
  };
}
