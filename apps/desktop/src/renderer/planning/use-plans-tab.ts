import type { Board } from "@sidecar/hosted/board-wire";
import { PLANNING_READ, type PlanCode, type PlanningView } from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { MicrophoneStatus } from "#shared/messages/audio";
import { VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { FIXTURE_PLANNING_CALL, fixturePlanningView, fixtureSidePanel } from "./planning-fixture";
import {
  type CallStatus,
  COPY_SHOWN,
  type CopyOutcome,
  type CopyShown,
  callStatus,
  copyPlanDocument,
  copyShown,
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  MICROPHONE_PRESS,
  microphoneButton,
  PLANS_PAGE,
  type PlansPage,
  planningCallHoldsPanel,
  plansPage,
} from "./planning-model";
import { type SidePanelControl, useSidePanel } from "./use-side-panel";

/**
 * use-plans-tab.ts -- the panel's Plans tab as one control: which page shows, the presses each page makes, and the host's read of the plans as the tab shows.
 *
 * The tab draws the planning view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * plan: the plan's notetaker writes the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. The plan the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Back, Escape, another plan, or a sign-out leaves it.
 */

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: PlansPage;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  plans: PlanningView["plans"];
  /** The folder of this Mac each plan reads, by plan id. */
  folders: PlanningView["folders"];
  activePlanId: string | undefined;
  listFailed: boolean;
  region: DocumentRegion;
  copy: { shown: CopyShown; onPress: () => void };
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  /** Ends the open plan's call at once, offered only while that call is in progress. */
  stop: { shown: boolean; onPress: () => void };
  /** The open plan's call status beside the microphone, absent while none stands. */
  status: CallStatus | undefined;
  /** Whether the open plan's call is in progress, so the plan is still being written. */
  live: boolean;
  /** The side panel beside the open plan's document: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The open plan's whiteboard as main holds it; absent before its first read lands. */
  board: Board | undefined;
  /** The code Luke has on screen, drawn only while the open plan's call is in progress. */
  code: PlanCode | undefined;
  onSelect: (planId: string) => void;
  /** Chooses a plan's folder on this Mac again, through the folder picker. */
  onChooseFolder: (planId: string) => void;
  /** Shows a plan's folder on this Mac in Finder. */
  onRevealFolder: (planId: string) => void;
  onRetryList: () => void;
  onRetryDocument: () => void;
  onNewPlan: () => void;
  /** The new-plan page's way back, and what a started plan closes it with. */
  onCancelNew: () => void;
  /** Leaves the open plan for the list, which ends its call. */
  onLeavePlan: () => void;
  /** Deletes a plan, which ends its call and returns to the list if it is the open one; answers whether it was deleted. */
  onDeletePlan: (planId: string) => Promise<ActionResult>;
  /** Steps back one page, answering whether there was a page to step back from. */
  back: () => boolean;
}

/** What a delete the service did not carry answers, so the plan stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The plan could not be deleted. Try again.",
};

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
  const sidePanel = useSidePanel(fixtureSidePanel(input.run));
  const planning = fixture ?? input.planning;
  const signedIn = fixture !== undefined || input.signedIn;
  const page = plansPage(planning, composing);
  const region = documentRegion(planning);

  // The tab showing is what asks the host to read the plans again; the open
  // plan and its call stand through it going away, and a call's drafts reach
  // the document without any read. A fixture's plans are read from nowhere.
  const reading = shown && signedIn && fixture === undefined;
  const wasReading = useRef(false);
  useEffect(() => {
    if (reading === wasReading.current) return;
    wasReading.current = reading;
    if (reading) tell(ACT_KIND.PLANNING_REFRESH);
  }, [reading, tell]);

  const select = useCallback(
    (planId: string) => {
      act(ACT_KIND.PLANNING_SELECT, { planId }).catch(() => undefined);
    },
    [act],
  );
  const leavePlan = useCallback(() => {
    if (fixture === undefined) tell(ACT_KIND.PLANNING_CLOSE);
  }, [fixture, tell]);

  // A fixture's plans are deleted nowhere, as they are read from nowhere.
  const deletePlan = async (planId: string): Promise<ActionResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await act(ACT_KIND.PLANNING_DELETE, { planId }).catch(() => false);
    return deleted ? { status: ACTION_RESULT_STATUS.ACCEPTED } : DELETE_REFUSED;
  };

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
    voiceStatus: voice.view.voiceStatus,
  });
  const live =
    planningCallHoldsPanel(voice.view) && voice.view.callPlanId === planning.activePlanId;
  // The press names no plan: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that plan or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) tell(ACT_KIND.PLANNING_TALK);
  };

  // The code pane stands for the call alone; a fixture's for its drawn call.
  const codeShown = live || fixture !== undefined;

  // A cancelled picker keeps whatever folder the plan had.
  const chooseFolder = (planId: string) => {
    act(ACT_KIND.PLANNING_CHOOSE_FOLDER).then(
      (folderPath) => {
        if (folderPath !== null) tell(ACT_KIND.PLANNING_SET_FOLDER, { planId, folderPath });
      },
      () => undefined,
    );
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
    folders: planning.folders,
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
      muted: microphone.muted,
      onPress: pressMicrophone,
    },
    // The stop is the voice window's to carry out, as every voice command is:
    // it holds the call, and ends whichever one stands.
    stop: {
      shown: live,
      onPress: () => tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL }),
    },
    // A fixture's open plan is drawn on a call with Luke working, read from
    // the fixture's own call rather than a voice window that holds none.
    status: callStatus(fixture === undefined ? voice.view : FIXTURE_PLANNING_CALL, planning),
    live,
    sidePanel,
    board: planning.board,
    code: codeShown ? planning.code : undefined,
    onSelect: select,
    onChooseFolder: chooseFolder,
    // A fixture's folders are named nowhere on this Mac, so none is shown.
    onRevealFolder: (planId) => {
      if (fixture === undefined) tell(ACT_KIND.PLANNING_REVEAL_FOLDER, { planId });
    },
    onRetryList: () => tell(ACT_KIND.PLANNING_REFRESH),
    onRetryDocument: () => {
      if (planning.activePlanId !== undefined) select(planning.activePlanId);
    },
    onNewPlan: () => onComposingChange(true),
    onCancelNew: () => onComposingChange(false),
    onLeavePlan: leavePlan,
    onDeletePlan: deletePlan,
    back,
  };
}
