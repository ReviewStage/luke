/**
 * panel-avatar.tsx -- Luke's avatar as the panel draws it: his voice from the panel's root, and his video in a small tile at the foot of the call's own agent's tab and on the call card.
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
import { agentCallVideoStatus } from "@luke/ui/call-card-model";
import type { AvatarStatus } from "@luke/voice/avatar";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useAct } from "../act.js";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge.js";
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
import { AvatarVoice, CallVideoTile } from "./call-video-tile.js";
import { CALL_TILE_WIDTH, useCallTileWidth } from "./use-call-tile-width.js";

/** What the tile's edge is called, for a reader and the keyboard. */
const RESIZE_LABEL = "Resize video";

/** What the tile leaves the tab beside it, in CSS pixels: an inset at each side, so it never meets the tab's edges. */
const TILE_RESERVE = 32;

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
  const { tell } = useAct();
  const view = useStandingVoiceView();
  const avatar = useVoiceAvatar();
  const videoCalls = useExperiment(EXPERIMENT.VIDEO_CALLS);
  return {
    status: agentCallVideoStatus({ view, avatar, agentId, videoCalls }),
    video: useAvatarTracks().video,
    onSetVideo: (on) => tell(ACT_KIND.VOICE_SET_VIDEO, { on }),
  };
}

/**
 * The tile at the foot of one agent's tab while the avatar stands, small and
 * floating over the transcript's foot (desktop.css), and nothing once video
 * is off. Its left edge drags it larger or smaller between
 * `CALL_TILE_WIDTH`'s bounds, the way it is anchored at its right, and the
 * width it is left at is kept for the next call. Video on and off are the
 * composer's (`agent-call.tsx`), so the tile offers neither.
 */
export function AgentCallVideo({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status, video, onSetVideo } = useAgentCallVideo(agentId);
  const { width, onResize } = useCallTileWidth();
  const edge = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width,
    bounds: CALL_TILE_WIDTH,
    reserve: () => TILE_RESERVE,
    label: RESIZE_LABEL,
    onResize,
  });
  return (
    <CallVideoTile
      video={video}
      status={status}
      onSetVideo={onSetVideo}
      toggles={false}
      width={width}
      edge={<div className="call-video-resize" {...edge} />}
    />
  );
}

/**
 * The avatar as the panel's call card draws it, on the same track, status,
 * and toggle as the agent's tab, or nothing while the card has no video to
 * offer.
 */
export function useCallCardVideo(): CallCardVideo | undefined {
  const { tell } = useAct();
  return cardVideo(useCardVideoStatus(), useAvatarTracks().video, tell);
}
