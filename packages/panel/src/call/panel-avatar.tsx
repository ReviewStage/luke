/**
 * panel-avatar.tsx -- Luke's avatar as the panel draws it: his voice from the panel's root, and his video centred above the composer of the call's own agent's tab and on the call card.
 *
 * The panel runs the avatar's session (`call-avatar.ts`) for as long as main
 * hands it a grant, whichever tab it shows and while it is hidden, because
 * the avatar's voice is what the developer hears: the voice window's own
 * element is muted while the avatar plays. So the voice is played from the
 * panel's root, and only the video is drawn in the tab of the agent the call
 * speaks into, and on the call card wherever the window docks it.
 * Both draw the one track the session published, each on an element of its
 * own, so a second view costs no second subscription and never drifts from
 * the first.
 */

import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react/Hooks";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import {
  AvatarVoice,
  CALL_VIDEO_FIT,
  CallVideoTile,
  cssCustomProperties,
  RESIZE_CORNER,
  ResizeCorner,
  type ResizeCornerSide,
  ResizeFrame,
  type ResizeTravel,
} from "@luke/ui";
import { agentCallVideoStatus } from "@luke/ui/call-card-model";
import { AVATAR_STATUS, type AvatarEndReason, type AvatarStatus } from "@luke/voice/avatar";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useMemo, useState } from "react";
import { useAct } from "../act.js";
import { useExperiment } from "../use-app-state.js";
import { useStandingVoiceView, useVoiceAvatar, useVoiceView } from "../use-voice-view.js";
import { avatarViewShareAtom } from "./avatar-view.js";
import {
  type CallAvatarTracks,
  callAvatarAtom,
  callAvatarAudioElementAtom,
  callAvatarPlaybackAtom,
  NO_AVATAR_TRACKS,
} from "./call-avatar.js";
import { type CallCardVideo, cardVideo, useCardVideoStatus } from "./call-card.js";
import { CALL_VIDEO_HEIGHT, useCallVideoHeight } from "./use-call-video-size.js";

/** The avatar's tracks as published so far, none before a session stands. */
function useAvatarTracks(): CallAvatarTracks {
  return Option.getOrElse(AsyncResult.value(useAtomValue(callAvatarAtom)), () => NO_AVATAR_TRACKS);
}

/**
 * The avatar's voice, mounted once at the panel's root and played for as
 * long as its track stands, and beside it the panel's end of the call
 * window's view of the video, which only the call window offers.
 */
export function PanelAvatarVoice(): React.JSX.Element {
  useAtomMount(callAvatarPlaybackAtom);
  useAtomMount(avatarViewShareAtom);
  const { view } = useVoiceView();
  const setAudioElement = useAtomSet(callAvatarAudioElementAtom);
  return (
    <AvatarVoice
      audio={useAvatarTracks().audio}
      speakerMuted={view.speakerMuted}
      onAudioElement={setAudioElement}
    />
  );
}

/** What an agent's tab draws of the avatar, and the door its Video on and off asks through. */
export interface AgentCallVideoState {
  /** The avatar's status on a call into the agent, `OFF` once video is down, and none where no video is offered. */
  status: AvatarStatus | undefined;
  video: MediaStreamTrack | undefined;
  /** Why the avatar ended, once it has. */
  endReason: AvatarEndReason | undefined;
  /** Asks main to put the avatar up again, a fresh session, or take it down. */
  onSetVideo: (on: boolean) => void;
}

/**
 * The avatar on a call into one agent: offered while that call is in
 * progress and the Video calls experiment is on, or while an avatar still
 * stands. Video off, Video on, and Restart video ask main to take the
 * avatar down or put it up again on the call standing.
 */
export function useAgentCallVideo(agentId: string): AgentCallVideoState {
  const { press } = useAct();
  const view = useStandingVoiceView();
  const avatar = useVoiceAvatar();
  const videoCalls = useExperiment(EXPERIMENT.VIDEO_CALLS);
  return {
    status: agentCallVideoStatus({ view, avatar, agentId, videoCalls }),
    video: useAvatarTracks().video,
    endReason: avatar.endReason,
    onSetVideo: (on) => press(ACT_KIND.VOICE_SET_VIDEO, { on }),
  };
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
export function AgentCallVideo({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status, video, endReason, onSetVideo } = useAgentCallVideo(agentId);
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
            endReason={endReason}
            fit={CALL_VIDEO_FIT.PICTURE}
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

/**
 * The avatar as the panel's call card draws it, on the same track, status,
 * and toggle as the agent's tab, or nothing while the card has no video to
 * offer.
 */
export function useCallCardVideo(): CallCardVideo | undefined {
  const { press } = useAct();
  const status = useCardVideoStatus();
  const track = useAvatarTracks().video;
  return useMemo(() => cardVideo(status, track, press), [status, track, press]);
}
