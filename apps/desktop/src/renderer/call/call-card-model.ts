/**
 * call-card-model.ts -- what the call card says about the standing call, and where it is drawn.
 *
 * The card draws no words of the conversation: the call's plan by name over
 * the call bar's own status and mutes. Everything here is read off the
 * document the card is handed, in the call bar's own terms, so the card and
 * the bar can never disagree about the call they draw.
 */

import type { PlanningView } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";
import { type CallStatus, standingCallStatus } from "../planning/planning-model";

/** The plan's name where the document has none to give, which a plan just started can briefly be. */
export const CALL_CARD_UNNAMED = "Planning call";

export interface CallCardModel {
  readonly planName: string;
  /** The call bar's own two lines for the standing call, which the card draws in the same bar. */
  readonly status: CallStatus | undefined;
  /** Whether the developer is not being heard on a call that could hear them. */
  readonly microphoneMuted: boolean;
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
    status: standingCallStatus(view, planning.callActivity),
    microphoneMuted: !view.listening && view.voiceStatus !== LIVE_STATUS.CONNECTING,
  };
}

/**
 * The plan whose call bar this window has on screen, or none: the Plans tab
 * on a plan's document, unless its version history or a side panel filling
 * the window covers the column the call bar stands in.
 */
export function callBarPlanId(input: {
  plansTab: boolean;
  documentPage: boolean;
  historyOpen: boolean;
  sidePanelFullScreen: boolean;
  activePlanId: string | undefined;
}): string | undefined {
  const covered = input.historyOpen || input.sidePanelFullScreen;
  return input.plansTab && input.documentPage && !covered ? input.activePlanId : undefined;
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
