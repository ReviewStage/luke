/**
 * call-window-card.tsx -- the floating call window's root: the call card alone, drawn from the window's own document.
 */

import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { useAct } from "@luke/panel/act";
import { useAppKeymap } from "@luke/panel/app-commands";
import { useAvatarView } from "@luke/panel/call/avatar-view";
import {
  CALL_CARD_SURFACE,
  CallCard,
  callControls,
  cardVideo,
  useCardVideoStatus,
} from "@luke/panel/call/call-card";
import { useKeyboardModality } from "@luke/panel/keyboard-modality";
import { APP_SLICE, useAppSlice } from "@luke/panel/use-app-state";
import { useVoiceView } from "@luke/panel/use-voice-view";
import { callCard } from "@luke/ui/call-card-model";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { useStaleHoverAfterMove } from "./window-pointer";

/**
 * The floating window's root: the card over the document it is handed. On
 * a video call it views the avatar's video from the panel, which runs the
 * avatar (`avatar-view.ts`), while its card draws the avatar live; main
 * grows the window to hold the tile on the same document. It reads keys
 * like the panel does, so the chords its hints show answer here too.
 */
export function CallWindowCard(): React.JSX.Element {
  useKeyboardModality();
  useStaleHoverAfterMove();
  // The window's own keys: the mute chords its hints name, which the voice view offers below.
  useAppKeymap(true);
  const { tell } = useAct();
  const planning = useAppSlice(APP_SLICE.TASKS);
  const { view } = useVoiceView();
  const videoStatus = useCardVideoStatus();
  const track = useAvatarView(videoStatus === AVATAR_STATUS.LIVE);
  return (
    <CallCard
      card={callCard({ view, tasks: planning ?? IDLE_TASKS_VIEW })}
      speakerMuted={view.speakerMuted}
      controls={callControls(tell, view.speakerMuted)}
      video={cardVideo(videoStatus, track, tell)}
      surface={CALL_CARD_SURFACE.WINDOW}
    />
  );
}
