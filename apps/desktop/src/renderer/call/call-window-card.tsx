/**
 * call-window-card.tsx -- the floating call window's root: the call card alone, drawn from the window's own document.
 */

import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { useAct } from "@luke/panel/act";
import { useAvatarView } from "@luke/panel/call/avatar-view";
import {
  CALL_CARD_SURFACE,
  CallCard,
  callControls,
  cardVideo,
  useCardVideoStatus,
} from "@luke/panel/call/call-card";
import { useKeyboardModality } from "@luke/panel/keyboard-modality";
import { useAppState } from "@luke/panel/use-app-state";
import { useVoiceView } from "@luke/panel/use-voice-view";
import { callCard } from "@luke/ui/call-card-model";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import { useStaleHoverAfterMove } from "./window-pointer";

/**
 * The floating window's root: the card over the document it is handed. On
 * a video call it views the avatar's video from the panel, which runs the
 * avatar (`avatar-view.ts`), while its card draws the avatar live; main
 * grows the window to hold the tile on the same document.
 */
export function CallWindowCard(): React.JSX.Element {
  useKeyboardModality();
  useStaleHoverAfterMove();
  const { tell } = useAct();
  const state = useAppState();
  const { view } = useVoiceView();
  const videoStatus = useCardVideoStatus();
  const track = useAvatarView(videoStatus === AVATAR_STATUS.LIVE);
  return (
    <CallCard
      card={callCard({ view, tasks: state?.tasks ?? IDLE_TASKS_VIEW })}
      speakerMuted={view.speakerMuted}
      controls={callControls(tell, view.speakerMuted)}
      video={cardVideo(videoStatus, track, tell)}
      surface={CALL_CARD_SURFACE.WINDOW}
    />
  );
}
