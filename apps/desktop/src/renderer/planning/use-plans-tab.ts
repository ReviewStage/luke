import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { MicrophoneStatus } from "#shared/messages/audio";
import type { VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { fixturePlanningView } from "./planning-fixture";
import {
  COPY_SHOWN,
  type CopyOutcome,
  type CopyShown,
  copyPlanDocument,
  copyShown,
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  MICROPHONE_PRESS,
  microphoneButton,
  microphoneStatusWord,
  PLANS_PAGE,
  type PlansPage,
  plansPage,
} from "./planning-model";

/**
 * use-plans-tab.ts -- the panel's Plans tab as one control: which page shows, the presses each page makes, and the host's follow of the plans while the tab shows.
 *
 * The tab draws the planning view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * plan: the planning model writes the document, and the tab redraws it in
 * place as the host's reads bring it. The plan the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Back, Escape, another plan, or a sign-out leaves it.
 */

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: PlansPage;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  plans: PlanningView["plans"];
  activePlanId: string | undefined;
  listFailed: boolean;
  region: DocumentRegion;
  copy: { shown: CopyShown; onPress: () => void };
  microphone: { label: string; enabled: boolean; onPress: () => void };
  /** The open plan's call status beside the microphone, absent while none stands. */
  status: string | undefined;
  onSelect: (planId: string) => void;
  onRetryList: () => void;
  onRetryDocument: () => void;
  onNewPlan: () => void;
  /** The new-plan page's way back, and what a started plan closes it with. */
  onCancelNew: () => void;
  /** Leaves the open plan for the list, which ends its call. */
  onLeavePlan: () => void;
  /** Steps back one page, answering whether there was a page to step back from. */
  back: () => boolean;
}

export function usePlansTab(input: {
  acts: Pick<ActHandle, "act" | "tell">;
  /** The plans main holds, the account's; a fixture run's own stand in for them. */
  planning: PlanningView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /**
   * Whether this panel is composing a new plan, held by the panel so that
   * arriving at the tab, like arriving at any tab, lands on its front page.
   */
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
  voice: {
    view: VoiceView;
    listening: boolean;
    requestMicrophoneAccess: () => void;
  };
}): PlansControl {
  const { shown, voice, composing, onComposingChange } = input;
  const { act, tell } = input.acts;
  const [copied, setCopied] = useState<CopyOutcome | undefined>(undefined);

  // A fixture run draws its synthetic plans in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixturePlanningView(input.run);
  const planning = fixture ?? input.planning;
  const signedIn = fixture !== undefined || input.signedIn;
  const page = plansPage(planning, composing);
  const region = documentRegion(planning);

  // The tab showing is what asks the host to read the plans and follow them,
  // and the tab going away is what stops the follow; the open plan and its
  // call stand through both. A fixture's plans are read from nowhere.
  const following = shown && signedIn && fixture === undefined;
  const wasFollowing = useRef(false);
  useEffect(() => {
    if (following === wasFollowing.current) return;
    wasFollowing.current = following;
    tell(following ? ACT_KIND.PLANNING_REFRESH : ACT_KIND.PLANNING_PAUSE);
  }, [following, tell]);

  const select = useCallback(
    (planId: string) => {
      act(ACT_KIND.PLANNING_SELECT, { planId }).catch(() => undefined);
    },
    [act],
  );
  const leavePlan = useCallback(() => {
    if (fixture === undefined) tell(ACT_KIND.PLANNING_CLOSE);
  }, [fixture, tell]);

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const openDocument = region.kind === DOCUMENT_REGION.READY ? region.plan.document : undefined;
  const pressCopy = () => {
    if (openDocument === undefined) return;
    copyPlanDocument(openDocument, (words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })).then(
      setCopied,
      () => undefined,
    );
  };

  const microphone = microphoneButton({
    voiceAvailable: input.voiceAvailable,
    microphoneStatus: input.microphoneStatus,
    activePlanId: planning.activePlanId,
    listening: voice.listening,
    callPlanId: voice.view.callPlanId,
  });
  // The press names no plan: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that plan or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) tell(ACT_KIND.PLANNING_TALK);
  };

  const back = useCallback((): boolean => {
    if (page === PLANS_PAGE.DOCUMENT) leavePlan();
    else if (page === PLANS_PAGE.NEW) onComposingChange(false);
    else return false;
    return true;
  }, [leavePlan, onComposingChange, page]);

  return {
    page,
    signedIn,
    plans: planning.plans,
    activePlanId: planning.activePlanId,
    listFailed: planning.listStatus === PLANNING_READ.FAILED,
    region,
    copy: {
      shown: openDocument === undefined ? COPY_SHOWN.IDLE : copyShown(copied, openDocument),
      onPress: pressCopy,
    },
    microphone: {
      label: microphone.label,
      enabled: microphone.press !== MICROPHONE_PRESS.NONE,
      onPress: pressMicrophone,
    },
    status: microphoneStatusWord(voice.view, planning.activePlanId),
    onSelect: select,
    onRetryList: () => tell(ACT_KIND.PLANNING_REFRESH),
    onRetryDocument: () => {
      if (planning.activePlanId !== undefined) select(planning.activePlanId);
    },
    onNewPlan: () => onComposingChange(true),
    onCancelNew: () => onComposingChange(false),
    onLeavePlan: leavePlan,
    back,
  };
}
