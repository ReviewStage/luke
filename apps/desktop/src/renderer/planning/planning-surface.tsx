import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { IDLE_PLANNING_VIEW, PLANNING_READ } from "@sidecar/hosted/planning-view";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";
import { useVoiceView } from "../use-voice-view";
import { WAVEFORM_VOICE } from "../waveform";
import {
  DOCUMENT_REGION,
  documentRegion,
  MICROPHONE_PRESS,
  microphoneButton,
  voiceBarLine,
} from "./planning-model";
import { PlanDocumentView, PlanList, VoiceBar } from "./planning-parts";
import { SetupSheet } from "./setup-sheet";

/**
 * planning-surface.tsx -- the planning window's one surface: the plan list, the open plan's saved document, and the voice bar.
 *
 * What it draws is the document main holds — the host's view of the plans,
 * and the voice window's report — and every press is an act. It saves
 * nothing and decides nothing about a plan: the planning model writes the
 * document, and the window redraws it in place as the host's reads bring it.
 * It does not record the session: that is the panel's alone.
 */

/**
 * Whether a planning call can be opened for the open plan. The call is the
 * voice connection's to bind to the active plan (`state.planning.activePlanId`),
 * and until it does the microphone button asks for access and nothing more.
 */
const PLANNING_CALL_BOUND = false;

export function PlanningSurface(): React.JSX.Element {
  const state = useAppState();
  const { act, tell } = useAct();
  const voice = useVoiceView();
  const [sheetOpen, setSheetOpen] = useState(false);

  const signedIn = state?.account.status === ACCOUNT_STATUS.SIGNED_IN;
  const planning = state?.planning ?? IDLE_PLANNING_VIEW;
  const region = documentRegion(planning);

  // The window standing is what asks the host to read the plans and follow
  // them, once it opens and again whenever an account signs in under it.
  useEffect(() => {
    if (signedIn) tell(ACT_KIND.PLANNING_REFRESH);
  }, [signedIn, tell]);

  // The window is an ordinary opaque one, which its stylesheet keys on.
  useEffect(() => {
    document.documentElement.dataset.surface = "planning";
  }, []);

  // The title bar names the open plan, the way a document window does.
  const title = region.kind === DOCUMENT_REGION.READY ? region.plan.name : "Plans";
  useEffect(() => {
    document.title = title;
  }, [title]);

  const select = useCallback(
    (planId: string) => {
      act(ACT_KIND.PLANNING_SELECT, { planId }).catch(() => undefined);
    },
    [act],
  );
  const retryDocument = () => {
    if (planning.activePlanId !== undefined) select(planning.activePlanId);
  };

  const microphone = microphoneButton({
    voiceAvailable: state?.settings?.status.voiceAvailable === true,
    microphoneStatus: state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED,
    activePlanId: planning.activePlanId,
    callBound: PLANNING_CALL_BOUND,
  });
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
  };
  const speaker = voice.speaking
    ? WAVEFORM_VOICE.LUKE
    : voice.listening
      ? WAVEFORM_VOICE.DEVELOPER
      : undefined;

  if (!signedIn) {
    return (
      <main className="planning planning-signed-out">
        <p>Sign in from Luke's panel to plan a feature.</p>
      </main>
    );
  }

  return (
    <main className="planning">
      <PlanList
        plans={planning.plans}
        activePlanId={planning.activePlanId}
        failed={planning.listStatus === PLANNING_READ.FAILED}
        onSelect={select}
        onRetry={() => tell(ACT_KIND.PLANNING_REFRESH)}
        onNewPlan={() => setSheetOpen(true)}
      />
      <div className="planning-main">
        <PlanDocumentView region={region} onRetry={retryDocument} />
        <VoiceBar
          line={voiceBarLine(voice.view)}
          level={speaker === undefined ? 0 : voice.levels[speaker]}
          voice={speaker}
          voiceActive={speaker === undefined ? false : voice.voiceActive[speaker]}
          // The planning model's delegated work is reported by the voice connection that binds the call.
          thinking={false}
          microphone={{
            label: microphone.label,
            enabled: microphone.press !== MICROPHONE_PRESS.NONE,
            onPress: pressMicrophone,
          }}
        />
      </div>
      {sheetOpen ? (
        <SetupSheet onStarted={() => setSheetOpen(false)} onCancel={() => setSheetOpen(false)} />
      ) : null}
    </main>
  );
}
