import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react/Hooks";
import {
  cssCustomProperties,
  RESIZE_CORNER,
  ResizeCorner,
  type ResizeCornerSide,
  ResizeFrame,
  type ResizeTravel,
} from "@luke/ui";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { useVoiceView } from "../use-voice-view.js";
import { NO_AVATAR_TRACKS } from "./avatar-grant.js";
import { avatarViewShareAtom } from "./avatar-view.js";
import {
  callAvatarAtom,
  callAvatarAudioElementAtom,
  callAvatarPlaybackAtom,
} from "./call-avatar.js";
import { AvatarVoice, CallVideoTile } from "./call-video-tile.js";
import { useAgentCallVideo } from "./panel-avatar.js";
import { CALL_VIDEO_HEIGHT, useCallVideoHeight } from "./use-call-video-size.js";

/**
 * video-calls.tsx -- what the panel draws of Luke's avatar, a chunk of its own read only while the Video calls experiment is on: his voice played from the panel's root, and his video above the composer of the call's own agent's tab.
 *
 * Its gates are `panel-avatar.tsx`'s, in the bundle every window parses,
 * which draw these through `experiments-on-demand.ts`.
 */

/**
 * The avatar's voice, played for as long as its track stands, and beside it
 * the panel's end of the call window's view of the video, which only the
 * call window offers.
 */
export function AvatarVoicePlayer(): React.JSX.Element {
  useAtomMount(callAvatarPlaybackAtom);
  useAtomMount(avatarViewShareAtom);
  const { view } = useVoiceView();
  const setAudioElement = useAtomSet(callAvatarAudioElementAtom);
  const { audio } = Option.getOrElse(
    AsyncResult.value(useAtomValue(callAvatarAtom)),
    () => NO_AVATAR_TRACKS,
  );
  return (
    <AvatarVoice audio={audio} speakerMuted={view.speakerMuted} onAudioElement={setAudioElement} />
  );
}

/** What the video's resize controls are called, for a reader and the keyboard. */
const CALL_VIDEO_RESIZE_LABEL = {
  [RESIZE_CORNER.LEFT]: "Resize video from its top-left corner",
  [RESIZE_CORNER.RIGHT]: "Resize video from its top-right corner",
} as const;

/** How far one arrow press on a corner grows or shrinks the video, in CSS pixels. */
const KEY_STEP = 16;

/** The stock avatars stream a square picture, which is what the video stands at until its own is known. */
const SQUARE = 1;

/**
 * How much a drag from a corner grows the video, in height: the way it went
 * up, or the way it went out sideways, whichever is the longer pull. The
 * video stands centred, so a corner moves out by half of what its width
 * grows, which is that over the aspect in height.
 */
function cornerGrowth(corner: ResizeCornerSide, aspect: number, travel: ResizeTravel): number {
  const up = -travel.y;
  const out = corner === RESIZE_CORNER.LEFT ? -travel.x : travel.x;
  const sideways = (2 * out) / aspect;
  return Math.abs(sideways) > Math.abs(up) ? sideways : up;
}

/**
 * Luke's video while a call into one agent stands, in its own room between
 * the agent's transcript and its composer (desktop.css), so the transcript
 * ends above it and nothing is ever drawn over the words. It stands centred
 * in that room, a rectangle at the picture's own aspect that the picture
 * fills, as tall as the developer left it (`use-call-video-size.ts`), 120 px on
 * a first call. Hovering it, or a drag or a key on its controls, brings out
 * how it resizes: a handle on each top corner, since it grows upward. Nothing at all once video is off, so the room goes with it.
 * Video on and off are the composer's (`agent-call.tsx`), so the video
 * offers neither.
 */
export function AgentCallVideoFrame({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status, video, onSetVideo } = useAgentCallVideo(agentId);
  const { height, onResize } = useCallVideoHeight();
  const [aspect, setAspect] = useState(SQUARE);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  if (status === undefined || status === AVATAR_STATUS.OFF) return null;
  return (
    <div
      className="agent-call-video"
      data-reveal={String(hovered || dragging)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={cssCustomProperties({
        "--call-video-height": `${height}px`,
        "--call-video-aspect": String(aspect),
      })}
    >
      <div className="agent-call-video-frame">
        <ResizeFrame reveal={hovered || dragging}>
          <CallVideoTile
            video={video}
            status={status}
            onSetVideo={onSetVideo}
            toggles={false}
            onAspect={setAspect}
          />
          {Object.values(RESIZE_CORNER).map((corner) => (
            <ResizeCorner
              key={corner}
              corner={corner}
              label={CALL_VIDEO_RESIZE_LABEL[corner]}
              value={height}
              min={CALL_VIDEO_HEIGHT.MIN}
              max={CALL_VIDEO_HEIGHT.MAX}
              step={KEY_STEP}
              growth={(travel) => cornerGrowth(corner, aspect, travel)}
              onResize={onResize}
              onDragging={setDragging}
            />
          ))}
        </ResizeFrame>
      </div>
    </div>
  );
}
