/**
 * call-window-card.tsx -- the floating call window's root: the call card, drawn from the window's own document, and the toasts its presses raise.
 */

import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { useAct } from "@luke/panel/act";
import { useAppKeymap } from "@luke/panel/app-commands";
import { CALL_CARD_SURFACE, CallCard, callControls } from "@luke/panel/call/call-card";
import { useKeyboardModality } from "@luke/panel/keyboard-modality";
import { ToastHost } from "@luke/panel/toast";
import { APP_SLICE, useAppSlice } from "@luke/panel/use-app-state";
import { useVoiceView } from "@luke/panel/use-voice-view";
import { TOAST_LOOK } from "@luke/ui";
import { callCard } from "@luke/ui/call-card-model";
import { useStaleHoverAfterMove } from "./window-pointer";

/**
 * The floating window's root: the card over the document it is handed. It reads keys
 * like the panel does, so the chords its hints show answer here too. A
 * press it makes that main refuses is said here, where it was pressed, by
 * the window's own toasts, compact and one at a time over its controls,
 * since the window is too small for the panel's cards and the panel may be
 * out of sight.
 */
export function CallWindowCard(): React.JSX.Element {
  useKeyboardModality();
  useStaleHoverAfterMove();
  // The window's own keys: the mute chords its hints name, which the voice view offers below.
  useAppKeymap(true);
  const { press } = useAct();
  const planning = useAppSlice(APP_SLICE.TASKS);
  const { view } = useVoiceView();
  return (
    <>
      <CallCard
        card={callCard({ view, tasks: planning ?? IDLE_TASKS_VIEW })}
        speakerMuted={view.speakerMuted}
        controls={callControls(press, view.speakerMuted)}
        surface={CALL_CARD_SURFACE.WINDOW}
      />
      <ToastHost look={TOAST_LOOK.COMPACT} />
    </>
  );
}
