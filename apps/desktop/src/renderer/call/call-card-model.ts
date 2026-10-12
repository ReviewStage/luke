/**
 * call-card-model.ts -- what the call card says about the standing call, and where it is drawn.
 *
 * The card draws no words of the conversation: the call's plan by name, one
 * status, and the state of its two mutes. Everything here is read off the
 * document the card is handed, so the card, the call bar, and the floating
 * window can never disagree about the call they draw.
 */

import type { PlanActivity, PlanningView } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";

/** What the status and the ring around Luke's mark are coloured as. */
export const CALL_CARD_TONE = {
  LUKE: "luke",
  DEVELOPER: "developer",
  MUTED: "muted",
  WORKING: "working",
  OPENING: "opening",
} as const;

type CallCardTone = (typeof CALL_CARD_TONE)[keyof typeof CALL_CARD_TONE];

/** The plan's name where the document has none to give, which a plan just started can briefly be. */
export const CALL_CARD_UNNAMED = "Planning call";

export interface CallCardModel {
  readonly planName: string;
  readonly status: { readonly words: string; readonly tone: CallCardTone };
  /** Whether the developer is not being heard on a call that could hear them. */
  readonly microphoneMuted: boolean;
}

function working(activity: PlanActivity | undefined): boolean {
  return activity?.planner !== undefined || activity?.notes === true;
}

/**
 * The status, most telling first: a call still opening says so, Luke's own
 * voice is what the developer is waiting on, then Luke writing the plan,
 * then the developer's mute, and an open microphone last, since that is
 * every call at rest. A call that is lost ends rather than reconnects, so
 * there is no reconnecting to say.
 */
function statusOf(
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening">,
  activity: PlanActivity | undefined,
): CallCardModel["status"] {
  if (view.voiceStatus === LIVE_STATUS.CONNECTING) {
    return { words: "Connecting…", tone: CALL_CARD_TONE.OPENING };
  }
  if (view.lukeSpeaking) return { words: "Luke speaking", tone: CALL_CARD_TONE.LUKE };
  if (working(activity)) return { words: "Writing…", tone: CALL_CARD_TONE.WORKING };
  if (!view.listening) return { words: "Muted", tone: CALL_CARD_TONE.MUTED };
  return { words: "Listening", tone: CALL_CARD_TONE.DEVELOPER };
}

/** The call's plan by name, from the list or the plan open, whichever holds it. */
function planNameOf(planning: PlanningView, planId: string | undefined): string {
  const open = planning.document.plan;
  const named =
    planning.plans.find((plan) => plan.id === planId)?.name ??
    (open !== undefined && open.id === planId ? open.name : undefined);
  return named === undefined || named === "" ? CALL_CARD_UNNAMED : named;
}

export function callCard(input: {
  view: Pick<VoiceView, "voiceStatus" | "lukeSpeaking" | "listening" | "callPlanId">;
  planning: PlanningView;
}): CallCardModel {
  const { view, planning } = input;
  return {
    planName: planNameOf(planning, view.callPlanId),
    status: statusOf(view, planning.callActivity),
    microphoneMuted: !view.listening && view.voiceStatus !== LIVE_STATUS.CONNECTING,
  };
}

/**
 * Whether a Luke window draws the card: a call in progress, the window has
 * the keyboard, and the plan it shows is not the call's, where the call bar
 * already is. A window without the keyboard leaves the call to the floating
 * window, so the call is drawn in one place at a time.
 */
export function callCardShown(input: {
  view: Pick<VoiceView, "voiceStatus" | "callPlanId">;
  focused: boolean;
  planShown: string | undefined;
}): boolean {
  const { view, focused, planShown } = input;
  return focused && callInProgress(view) && planShown !== view.callPlanId;
}
