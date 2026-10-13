/**
 * call-window-root.tsx -- the floating call window's root: the call card, or the video tile while the call has Luke's face.
 *
 * What the window draws follows the document's face: none draws the card,
 * and any other draws the tile, which main has grown the window to hold
 * (`main/window/call-window.ts`). The tile's tracks come from the avatar room
 * main hands this window alone (`avatar-room-feed.ts`); its status is the
 * document's, which the first frame drawn here moves to live.
 */

import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { ACT_KIND } from "#shared/messages/acts";
import { AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "#shared/messages/avatar";
import { VOICE_COMMAND } from "#shared/messages/voice-view";
import { actRequest, useAct } from "../act";
import { useKeyboardModality } from "../keyboard-modality";
import { rendererRuntime } from "../renderer-runtime";
import { useAppState } from "../use-app-state";
import { avatarRoomFeed } from "./avatar-room-feed";
import { CallWindowCard } from "./call-card";
import { CallVideoTile } from "./call-video-tile";
import { CALL_VIDEO_STATUS, type CallVideoStatus } from "./call-video-tile-model";
import { useStaleHoverAfterMove } from "./window-pointer";

type ShownAvatarStatus = Exclude<AvatarState["status"], typeof AVATAR_STATUS.OFF>;

/** The face's status in the tile's own terms: a face starting is the tile connecting. */
const TILE_STATUS = {
  [AVATAR_STATUS.STARTING]: CALL_VIDEO_STATUS.CONNECTING,
  [AVATAR_STATUS.LIVE]: CALL_VIDEO_STATUS.LIVE,
  [AVATAR_STATUS.ENDED]: CALL_VIDEO_STATUS.ENDED,
} as const satisfies { readonly [Status in ShownAvatarStatus]: CallVideoStatus };

/** Tells main the face drew; an act that cannot be carried leaves the tile connecting, which is all there is to do. */
const reportFirstFrame = Effect.ignore(
  Effect.tryPromise(() =>
    window.sidecar.act(actRequest(ACT_KIND.CALL_AVATAR_FIRST_FRAME, undefined)),
  ),
);

/**
 * The avatar's tracks, for as long as the tile is drawn: the room is joined
 * while something reads this atom and left once nothing does, so a tile
 * taken down leaves the room with it.
 */
const avatarTracksAtom = rendererRuntime.atom(
  avatarRoomFeed(
    {
      subscribe: (onDelivered) => window.sidecar.onAvatarRoom(onDelivered),
      request: () => window.sidecar.requestAvatarRoom(),
    },
    { reportFirstFrame },
  ),
);

/**
 * The tile over the face's status and the room's tracks. Hang up ends the
 * call as the card's own end does; turning the video off and restarting it
 * are the video's own acts, which this window does not carry yet, so those
 * two presses do nothing until they are bound.
 */
function CallWindowVideo({ status }: { status: ShownAvatarStatus }): React.JSX.Element {
  const { tell } = useAct();
  const tracks = AsyncResult.getOrElse(useAtomValue(avatarTracksAtom), () => undefined);
  return (
    <CallVideoTile
      video={tracks?.video}
      audio={tracks?.audio}
      status={TILE_STATUS[status]}
      onVideoOff={() => undefined}
      onRestart={() => undefined}
      onHangUp={() => tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL })}
    />
  );
}

/** The floating window's root, mounted by the role main answers it. */
export function CallWindowRoot(): React.JSX.Element {
  useKeyboardModality();
  useStaleHoverAfterMove();
  const { status } = useAppState()?.voice.avatar ?? AVATAR_OFF;
  return status === AVATAR_STATUS.OFF ? <CallWindowCard /> : <CallWindowVideo status={status} />;
}
