/**
 * panel-avatar.tsx -- Luke's avatar as the panel draws it: his voice from the panel's root, and his video at the top of the call's own Call tab.
 *
 * The panel runs the avatar's session (`call-avatar.ts`) for as long as main
 * hands it a grant, whichever tab it shows and while it is hidden, because
 * the avatar's voice is what the developer hears: the voice window's own
 * element is muted while the avatar plays. So the voice is played from the
 * panel's root, and only the video is drawn in the Call tab, on the plan
 * the call is about.
 */

import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react/Hooks";
import { ACT_KIND } from "@luke/host/acts";
import { callTabVideoStatus } from "@luke/ui/call-card-model";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";
import { useVoiceView } from "../use-voice-view";
import {
  type CallAvatarTracks,
  callAvatarAtom,
  callAvatarAudioElementAtom,
  callAvatarPlaybackAtom,
  NO_AVATAR_TRACKS,
} from "./call-avatar";
import { callControls } from "./call-card";
import { AvatarVoice, CallVideoTile } from "./call-video-tile";

/** The avatar's tracks as published so far, none before a session stands. */
function useAvatarTracks(): CallAvatarTracks {
  return Option.getOrElse(AsyncResult.value(useAtomValue(callAvatarAtom)), () => NO_AVATAR_TRACKS);
}

/** The avatar's voice, mounted once at the panel's root and played for as long as its track stands. */
export function PanelAvatarVoice(): React.JSX.Element {
  useAtomMount(callAvatarPlaybackAtom);
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

/**
 * The video tile on one plan's Call tab: drawn while that plan's call is in
 * progress and its avatar is starting, live, or ended for a reason it offers
 * to restart from. Video off and Restart video ask main to take the avatar
 * down or put it up again on the call standing.
 */
export function CallTabVideo({ planId }: { planId: string }): React.JSX.Element | null {
  const { tell } = useAct();
  const state = useAppState();
  const { view } = useVoiceView();
  const avatar = state?.voice.avatar ?? AVATAR_OFF;
  return (
    <CallVideoTile
      video={useAvatarTracks().video}
      status={callTabVideoStatus({ view, avatar, planId })}
      onVideoOff={() => tell(ACT_KIND.VOICE_SET_VIDEO, { on: false })}
      onRestart={() => tell(ACT_KIND.VOICE_SET_VIDEO, { on: true })}
      onHangUp={callControls(tell, view.speakerMuted).onEnd}
    />
  );
}
