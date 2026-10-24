/**
 * window-voice.tsx -- what the window draws of the voice beside its pages: the call card, the voice's notices, and the call's chords, each read where it is drawn.
 *
 * The voice moves with every word said on a call, and who is heard on it
 * with every breath, so the window's root reads none of it: each part here
 * reads what it draws and hands it down through a context its docks alone
 * read, and the pages between them are not drawn again for it.
 */

import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { VOICE_REMEDY, type VoiceRemedy } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { callCard, callCardShown } from "@luke/ui/call-card-model";
import {
  outputSilent,
  type VolumeHintDismissal,
  volumeHintDismissed,
  volumeHintText,
} from "@luke/voice/volume-hint";
import * as Atom from "effect/reactivity/Atom";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "./act.js";
import { CallCardContext, type CallCardInput, callControls } from "./call/call-card.js";
import { useCallCardVideo } from "./call/panel-avatar.js";
import { useWindowFocused } from "./call/use-window-focused.js";
import { useOpenApiKeys } from "./openai-key.js";
import { useOpenLink } from "./tasks/use-open-link.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";
import { useVoiceNotice } from "./use-voice-notice.js";
import { fixtureVoice, useStandingVoiceView, useVoiceView } from "./use-voice-view.js";
import { OPENAI_BILLING_URL, useVoiceNoticeToast } from "./voice-notice-toast.js";

/** The Mac's output as last read, which the volume hint answers. */
const OUTPUT_AUDIO = Atom.map(APP_SLICE.AUDIO, (audio) => audio?.outputAudio);

/** The launch profile, which stages a capture run's conversation. */
const RUN_PROFILE_NAME = Atom.map(APP_SLICE.RUN, (run) => run?.profile);

/**
 * The call's chords, the menu bar's and the keys': read here, where nothing
 * else is drawn, because they answer to the voice as it moves.
 */
export function CallChords(): null {
  useVoiceView();
  return null;
}

/**
 * The window's voice notice: a failure, a notice, or the hint that Luke speaks
 * into a silent Mac, which a "Got it" quiets for the stretch of silence it
 * answered. Stood as a toast in the window's one stack (`voice-notice-toast.ts`).
 */
function VoiceNotices({ children }: { children: ReactNode }): React.JSX.Element {
  const view = useStandingVoiceView();
  const outputAudio = useAppSlice(OUTPUT_AUDIO);
  // A capture run stages who is heard, and for the muted run the hint, since no voice window stands in one.
  const fixture = fixtureVoice(useAppSlice(RUN_PROFILE_NAME) ?? "");
  /**
   * Which stretch of unbroken silence is on screen, advanced each time one
   * begins. A "Got it" is remembered against the stretch it answered, so it
   * holds for that whole mute and lapses naturally with it.
   */
  const [silenceStretch, setSilenceStretch] = useState(0);
  const wasSilent = useRef(false);
  const [hintDismissal, setHintDismissal] = useState<VolumeHintDismissal>();
  // Silence is counted in stretches — one per unbroken run of muted-or-zero —
  // because that is the unit a "Got it" answers. The edge into silence is the
  // only thing counted; every reading inside one stretch leaves it alone.
  useEffect(() => {
    const silent = outputSilent(outputAudio);
    if (silent && !wasSilent.current) setSilenceStretch((stretch) => stretch + 1);
    wasSilent.current = silent;
  }, [outputAudio]);
  const notice = useVoiceNotice({
    voiceError: view.voiceError,
    voiceNotice: view.voiceNotice,
    speakers: fixture?.speakers ?? { listening: view.listening, lukeSpeaking: view.lukeSpeaking },
    fixtureSpeaking: fixture !== undefined,
    // The hint asks only over a silence the helper actually reported, and "Got it" quiets it for this stretch and any that follows too soon.
    volumeHint: {
      wanted:
        (fixture?.muted ?? false) ||
        (outputSilent(outputAudio) &&
          !volumeHintDismissed(hintDismissal, silenceStretch, Date.now())),
      text: volumeHintText(outputAudio),
    },
  });
  /**
   * The hint's own button. It quiets the hint for this stretch of silence;
   * Luke's words go on streaming into the transcript, which is what "got
   * it" leaves the user reading him by.
   */
  const onDismissHint = useCallback(() => {
    setHintDismissal({ at: Date.now(), stretch: silenceStretch });
  }, [silenceStretch]);
  const { press } = useAct();
  const openApiKeys = useOpenApiKeys();
  const openLink = useOpenLink();
  /** A failure's remedy, done where it is done: Settings for the OpenAI key, OpenAI's billing for its credit, System Settings for the microphone. */
  const onRemedy = useCallback(
    (remedy: VoiceRemedy) => {
      switch (remedy) {
        case VOICE_REMEDY.ADD_OPENAI_KEY:
          openApiKeys();
          return;
        case VOICE_REMEDY.ADD_OPENAI_CREDIT:
          openLink(OPENAI_BILLING_URL);
          return;
        case VOICE_REMEDY.ALLOW_MICROPHONE:
          press(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
          return;
      }
    },
    [openApiKeys, openLink, press],
  );
  useVoiceNoticeToast({ notice, onDismissHint, onRemedy });
  return <>{children}</>;
}

/**
 * The window's call card, while it draws one: past the sign-in, while the
 * window has the keyboard, and while the call's own bar is not on screen
 * (`callBarAgentId`). Handed to the card's docks (`StandingCallCardDock`).
 */
function StandingCallCard({
  available,
  agentShown,
  children,
}: {
  available: boolean;
  agentShown: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { press } = useAct();
  const view = useStandingVoiceView();
  const focused = useWindowFocused();
  const planning = useAppSlice(APP_SLICE.TASKS) ?? IDLE_TASKS_VIEW;
  const video = useCallCardVideo();
  const shown = available && callCardShown({ view, focused, agentShown });
  const { speakerMuted } = view;
  const card = useMemo(
    () => (shown ? callCard({ view, tasks: planning }) : undefined),
    [shown, view, planning],
  );
  const controls = useMemo(() => callControls(press, speakerMuted), [press, speakerMuted]);
  const call = useMemo<CallCardInput | undefined>(
    () => (card === undefined ? undefined : { card, speakerMuted, controls, video }),
    [card, speakerMuted, controls, video],
  );
  return <CallCardContext.Provider value={call}>{children}</CallCardContext.Provider>;
}

/**
 * The voice the window draws beside its pages, around them: the call card,
 * handed to where it docks, and the voice's notices, stood as toasts. `available` is
 * whether the window is past the sign-in, and `agentShown` the agent whose
 * call bar the window has on screen, where the card gives way to it.
 */
export function WindowVoice({
  available,
  agentShown,
  children,
}: {
  available: boolean;
  agentShown: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <StandingCallCard available={available} agentShown={agentShown}>
      <VoiceNotices>{children}</VoiceNotices>
    </StandingCallCard>
  );
}
