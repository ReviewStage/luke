/**
 * call-pill-model.ts -- what the floating call pill says about the standing call.
 *
 * The pill draws no words of the conversation: the plan's name, one status
 * in the call bar's own words, and whose voice the meter follows. Everything
 * here is read off the document the pill is handed, so the pill and the call
 * bar can never disagree about the call they both draw.
 */

import type { PlanActivity, PlanningView } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import type { VoiceView } from "#shared/messages/voice-view";
import { NOTETAKER_WRITING, PLANNER_NAME, PLANNER_THINKING } from "../planning/planning-parts";
import { WAVEFORM_VOICE, type WaveformVoice } from "../waveform";

/** What the status line is coloured as: whose voice, a mute, Luke at work, or a call still opening. */
export const CALL_PILL_TONE = {
  LUKE: "luke",
  DEVELOPER: "developer",
  MUTED: "muted",
  WORKING: "working",
  OPENING: "opening",
} as const;

type CallPillTone = (typeof CALL_PILL_TONE)[keyof typeof CALL_PILL_TONE];

/** The plan's name where the document has none to give, which a plan just started can briefly be. */
export const CALL_PILL_UNNAMED = "Planning call";

export interface CallPill {
  readonly planName: string;
  readonly status: { readonly words: string; readonly tone: CallPillTone };
  /** Whose voice the meter follows, or none while neither is heard. */
  readonly meterVoice: WaveformVoice | undefined;
  /** Whether the developer is not being heard on a call that could hear them. */
  readonly microphoneMuted: boolean;
}

/** The backend's line, in the call bar's words, or nothing while no part of Luke is working. */
function workingWords(activity: PlanActivity | undefined): string | undefined {
  const planner = activity?.planner;
  if (planner !== undefined) return `${PLANNER_NAME} · ${planner.action ?? PLANNER_THINKING}`;
  return activity?.notes === true ? NOTETAKER_WRITING : undefined;
}

/**
 * The status, most telling first: a call still opening says so, Luke's own
 * voice is what the developer is waiting on, then Luke at work on the plan,
 * then the developer's mute, and an open microphone last, since that is
 * every call at rest.
 */
function statusOf(
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening">,
  activity: PlanActivity | undefined,
): CallPill["status"] {
  if (view.voiceStatus === LIVE_STATUS.CONNECTING) {
    return { words: "Connecting", tone: CALL_PILL_TONE.OPENING };
  }
  if (view.lukeSpeaking) return { words: "Luke speaking", tone: CALL_PILL_TONE.LUKE };
  const working = workingWords(activity);
  if (working !== undefined) return { words: working, tone: CALL_PILL_TONE.WORKING };
  if (!view.listening) return { words: "Muted", tone: CALL_PILL_TONE.MUTED };
  return { words: "Listening", tone: CALL_PILL_TONE.DEVELOPER };
}

/** The call's plan by name, from the list or the plan open, whichever holds it. */
function planNameOf(planning: PlanningView, planId: string | undefined): string {
  const open = planning.document.plan;
  const named =
    planning.plans.find((plan) => plan.id === planId)?.name ??
    (open !== undefined && open.id === planId ? open.name : undefined);
  return named === undefined || named === "" ? CALL_PILL_UNNAMED : named;
}

export function callPill(input: {
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening" | "callPlanId">;
  planning: PlanningView;
}): CallPill {
  const { view, planning } = input;
  return {
    planName: planNameOf(planning, view.callPlanId),
    status: statusOf(view, planning.callActivity),
    meterVoice: view.lukeSpeaking
      ? WAVEFORM_VOICE.LUKE
      : view.listening
        ? WAVEFORM_VOICE.DEVELOPER
        : undefined,
    microphoneMuted: !view.listening && view.voiceStatus !== LIVE_STATUS.CONNECTING,
  };
}
