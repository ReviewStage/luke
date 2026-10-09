import type { Board } from "@sidecar/hosted/board-wire";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanCode,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND, type ActResultFor } from "#shared/messages/acts";
import type { MicrophoneStatus } from "#shared/messages/audio";
import { VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import {
  FIXTURE_PLANNING_CALL,
  fixturePlanningView,
  fixtureRepositories,
  fixtureSidePanel,
} from "./planning-fixture";
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
  type PendingRenames,
  PLANS_PAGE,
  type PlansPage,
  planningCallInProgress,
  plansPage,
  recentRepositories,
  renamedView,
  repositoryFailureNote,
  repositoryPageUrl,
  unsettledRenames,
} from "./planning-model";
import type { RepositoryChooser } from "./repository-chip";
import {
  type HeardCall,
  heardCalls,
  type TranscriptRegion,
  transcriptRegion,
} from "./transcript-model";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";
import { usePanelArrivals } from "./use-panel-arrivals";
import {
  isAgentTab,
  type SidePanelControl,
  type SidePanelTab,
  useSidePanel,
} from "./use-side-panel";

/**
 * use-plans-tab.ts -- the panel's Plans tab as one control: which page shows, the presses each page makes, and the host's read of the plans as the tab shows.
 *
 * The tab draws the planning view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * plan: the plan's notetaker writes the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename is the one
 * press drawn before the host answers it: the new name shows at once, and
 * goes back to the old one if the service refuses it. The plan the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another plan, New plan, a delete, or a sign-out
 * leaves it. With none open, the tab is the new-plan page. The open plan's
 * coding agents are the tab's too (`use-coding-agents.ts`): read when the
 * plan opens, started from the toolbar, and each drawn on a tab of the side
 * panel. Main is told which agent's tab is shown, so the notification it
 * posts when an agent ends is held back while the developer is looking at
 * that agent, and the agents main says ended unseen wear a dot until their
 * tab is shown (`main/agent-notices.ts`).
 */

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: PlansPage;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  plans: PlanningView["plans"];
  activePlanId: string | undefined;
  /**
   * The plan the tab is on its way to: the one a press asked the host for,
   * until the host's open plan next moves, else the open one. Nothing is the
   * new-plan page, asked for or standing.
   */
  boundFor: string | undefined;
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
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents that ended unseen, each until it is shown. */
  unreadTabs: readonly SidePanelTab[];
  /** The open plan's whiteboard as main holds it; absent before its first read lands. */
  board: Board | undefined;
  /** The code Luke has on screen, drawn only while the open plan's call is in progress. */
  code: PlanCode | undefined;
  /** What was said on the open plan's calls, the call standing now included, and the retry of a read that failed. */
  transcript: { region: TranscriptRegion; onRetry: () => void };
  /** What Luke's planning model wrote and ran on the open plan's calls, and whether its call still stands. */
  work: { turns: PlanningView["work"]; callLive: boolean };
  /** The open plan's coding agents: their tabs, the Start, and the Stop. */
  agents: CodingAgentsControl;
  onSelect: (planId: string) => void;
  /** Opens a plan on one agent's tab: what a notification's click asks. */
  onShowAgent: (planId: string, agentId: string) => void;
  /** What the repository chip offers, in the composer and on the open plan alike. */
  repositories: RepositoryChooser;
  /** The ask standing for the open plan's chip to open its menu: which plan it is about, and how many asks so far. */
  repositoryMenu: { planId: string; request: number } | undefined;
  /** Opens a plan's repository chip menu, opening the plan first where it is not the open one. */
  onChangeRepository: (planId: string) => void;
  /** Gives a plan its repository, or takes it away with null; answers why the service refused, or nothing once it is kept. */
  onSetRepository: (planId: string, repository: string | null) => Promise<string | undefined>;
  /** Opens a plan's repository on GitHub in the browser. */
  onOpenOnGitHub: (planId: string) => void;
  onRetryList: () => void;
  onRetryDocument: () => void;
  /** Leaves any open plan for the new-plan page, and has that page focus its name field. */
  onNewPlan: () => void;
  /** What the new-plan page offers and the two presses it makes. */
  newPlan: {
    /** Counts the presses of New plan, so the page focuses its name field on each. */
    presses: number;
    /** Starts the plan on the repository given, or none, which opens it; answers why it did not start, or nothing once it has. */
    start: (name: string, repository: string | null) => Promise<string | undefined>;
  };
  /** Leaves the open plan for the new-plan page, which ends its call. */
  onLeavePlan: () => void;
  /**
   * Renames a plan to a name already trimmed and changed, drawn under it at
   * once and under its old name again if the service refuses; answers
   * whether it was renamed.
   */
  onRenamePlan: (planId: string, name: string) => Promise<boolean>;
  /** Deletes a plan, which ends its call and returns to the new-plan page if it is the open one; answers whether it was deleted. */
  onDeletePlan: (planId: string) => Promise<ActionResult>;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, else an open
   * plan back to the new-plan page.
   */
  back: () => boolean;
}

/**
 * A plan asked of the host, or the new-plan page as nothing, and the open
 * plan it was asked over: the ask stands only while that plan is still the
 * open one, so the host's next move, whatever it is, answers it.
 */
interface PlanAsk {
  planId: string | undefined;
  over: string | undefined;
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
  /** The agents main says ended while no one was looking, each until its tab is shown. */
  unseenAgents: readonly string[];
  voice: {
    view: VoiceView;
    listening: boolean;
    requestMicrophoneAccess: () => void;
  };
}): PlansControl {
  const { shown, voice } = input;
  const { act, tell } = input.acts;
  const [copied, setCopied] = useState<CopyOutcome | undefined>(undefined);
  const [newPlanPresses, setNewPlanPresses] = useState(0);
  const [repositoryMenu, setRepositoryMenu] = useState<PlansControl["repositoryMenu"]>(undefined);
  const [asked, setAsked] = useState<PlanAsk | undefined>(undefined);

  // A fixture run draws its synthetic plans in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixturePlanningView(input.run);
  const viewed = fixture ?? input.planning;
  // A started agent's tab opens selected; the panel is built after the
  // agents it draws, so the opening reaches it through this late binding.
  const panelRef = useRef<SidePanelControl | undefined>(undefined);
  const openDocument = viewed.document.plan;
  // A fixture's plans have no agents, as they are read from nowhere.
  const agents = useCodingAgents({
    acts: input.acts,
    planId: fixture === undefined ? viewed.activePlanId : undefined,
    repository:
      openDocument?.id === viewed.activePlanId ? (openDocument?.repository ?? null) : null,
    onStarted: (agentId) => panelRef.current?.onChoose({ agent: agentId }),
  });
  const sidePanel = useSidePanel(fixtureSidePanel(input.run), agents.agentIds);
  panelRef.current = sidePanel;
  // Main hears which agent's tab is on screen, and none while the tab is
  // away or the panel shows something else; a fixture's staged agents are
  // no one's to announce.
  const shownAgent =
    shown &&
    fixture === undefined &&
    sidePanel.open &&
    sidePanel.tab !== undefined &&
    isAgentTab(sidePanel.tab)
      ? sidePanel.tab.agent
      : null;
  const reportedAgent = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reportedAgent.current === shownAgent) return;
    reportedAgent.current = shownAgent;
    tell(ACT_KIND.CODING_AGENTS_SHOWN, { agentId: shownAgent });
  }, [shownAgent, tell]);
  // A name given here stands until main's view carries it, so a rename that
  // landed never flickers back while main's copy of the view catches up.
  const [renames, setRenames] = useState<PendingRenames>(new Map());
  useEffect(() => setRenames((held) => unsettledRenames(held, viewed)), [viewed]);
  const planning = renamedView(viewed, renames);
  const signedIn = fixture !== undefined || input.signedIn;
  const page = plansPage(planning);
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

  // The host answers a press a round trip later, so where the tab is bound
  // is said at once, and a select that did not open the plan takes its ask
  // back. A fixture's plans are opened nowhere, so nothing is asked of them.
  const openPlanId = planning.activePlanId;
  const boundFor = asked !== undefined && asked.over === openPlanId ? asked.planId : openPlanId;
  const select = useCallback(
    (planId: string) => {
      const ask = { planId, over: openPlanId };
      const withdraw = () => setAsked((held) => (held === ask ? undefined : held));
      if (fixture === undefined) setAsked(ask);
      act(ACT_KIND.PLANNING_SELECT, { planId }).then((opened) => {
        if (!opened) withdraw();
      }, withdraw);
    },
    [act, fixture, openPlanId],
  );
  // A leave is asked rather than told, so a refused one takes its ask back too.
  const leavePlan = useCallback(() => {
    if (fixture !== undefined) return;
    const ask = { planId: undefined, over: openPlanId };
    setAsked(ask);
    act(ACT_KIND.PLANNING_CLOSE).catch(() => setAsked((held) => (held === ask ? undefined : held)));
  }, [act, fixture, openPlanId]);

  // A fixture's plans are deleted nowhere, as they are read from nowhere.
  const deletePlan = async (planId: string): Promise<ActionResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await act(ACT_KIND.PLANNING_DELETE, { planId }).catch(() => false);
    return deleted ? { status: ACTION_RESULT_STATUS.ACCEPTED } : DELETE_REFUSED;
  };

  // A fixture's plans are renamed nowhere, as they are read from nowhere.
  const renamePlan = async (planId: string, name: string): Promise<boolean> => {
    if (fixture !== undefined) return false;
    setRenames((held) => new Map(held).set(planId, name));
    const renamed = await act(ACT_KIND.PLANNING_RENAME, { planId, name }).catch(() => false);
    if (!renamed) {
      setRenames((held) =>
        held.get(planId) === name
          ? new Map([...held].filter(([pending]) => pending !== planId))
          : held,
      );
    }
    return renamed;
  };

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const drawnDocument = region.kind === DOCUMENT_REGION.READY ? region.plan.document : undefined;
  const pressCopy = () => {
    if (drawnDocument === undefined) return;
    copyPlanDocument(drawnDocument, (words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })).then(
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
    planningCallInProgress(voice.view) && voice.view.callPlanId === planning.activePlanId;
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
  const code = codeShown ? planning.code : undefined;
  // A fixture's staged plan has nothing arriving on it.
  const arrivedTabs = usePanelArrivals({
    planId: fixture === undefined ? planning.activePlanId : undefined,
    board: planning.board,
    code,
    panel: sidePanel,
  });
  // An agent that ended unseen dots its tab the way an arrival does; main
  // clears it once the tab is shown.
  const unreadTabs: readonly SidePanelTab[] = [
    ...arrivedTabs,
    ...input.unseenAgents.map((agent): SidePanelTab => ({ agent })),
  ];

  // A fixture's repositories are read from nowhere, as its plans are.
  const readRepositories = (): Promise<ActResultFor<typeof ACT_KIND.PLANNING_REPOSITORIES>> =>
    fixture !== undefined
      ? Promise.resolve(fixtureRepositories())
      : act(ACT_KIND.PLANNING_REPOSITORIES).catch(() => ({
          failure: PLAN_CALL_FAILURE.UNANSWERED,
        }));
  const openGitHub = (url: string) => tell(ACT_KIND.GITHUB_OPEN, { url });

  // A fixture's plans are given no repository, as they are read from nowhere.
  const setRepository = (
    planId: string,
    repository: string | null,
  ): Promise<string | undefined> => {
    if (fixture !== undefined) return Promise.resolve(undefined);
    return act(ACT_KIND.PLANNING_SET_REPOSITORY, { planId, repository }).then(
      (answer) => ("failure" in answer ? repositoryFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );
  };

  // The chip's menu stands on the open plan's toolbar, so another plan's is
  // opened first; the ask is counted so each press opens it again.
  const changeRepository = (planId: string) => {
    if (planId !== planning.activePlanId) select(planId);
    setRepositoryMenu((held) => ({ planId, request: (held?.request ?? 0) + 1 }));
  };

  const repositoryOf = (planId: string): string | null =>
    planning.plans.find((plan) => plan.id === planId)?.repository ??
    (region.kind === DOCUMENT_REGION.READY && region.plan.id === planId
      ? region.plan.repository
      : null);

  // The calls heard on the open plan, each held past its end until the
  // record's copy catches up; a fixture's open plan is drawn with its own
  // call's words.
  const reported = fixture === undefined ? voice.view : FIXTURE_PLANNING_CALL;
  const [heard, setHeard] = useState<readonly HeardCall[]>([]);
  useEffect(() => {
    setHeard((held) =>
      heardCalls({
        held,
        voice: { callPlanId: reported.callPlanId, callTranscript: reported.callTranscript },
        planId: planning.activePlanId,
        now: Date.now(),
      }),
    );
  }, [reported.callPlanId, reported.callTranscript, planning.activePlanId]);

  // A started plan becomes the host's open one, which turns the page to it.
  const startPlan = (name: string, repository: string | null): Promise<string | undefined> =>
    act(ACT_KIND.PLANNING_START, {
      name,
      ...(repository === null ? undefined : { repository }),
    }).then(
      (answer) => ("failure" in answer ? repositoryFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );

  // The new-plan page is the tab's home, so only an open plan steps back,
  // and a panel filling the window over it is the nearer layer.
  const back = useCallback((): boolean => {
    if (page !== PLANS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leavePlan();
    return true;
  }, [leavePlan, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  return {
    page,
    shown,
    signedIn,
    plans: planning.plans,
    activePlanId: planning.activePlanId,
    boundFor,
    listFailed: planning.listStatus === PLANNING_READ.FAILED,
    region,
    copy: {
      shown: drawnDocument === undefined ? COPY_SHOWN.IDLE : copyShown(copied, drawnDocument),
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
    status: callStatus(reported, planning),
    live,
    sidePanel,
    unreadTabs,
    board: planning.board,
    code,
    transcript: {
      region: transcriptRegion({ transcript: planning.transcript, heard }),
      onRetry: () => tell(ACT_KIND.PLANNING_REFRESH),
    },
    // A fixture's open plan is drawn mid-call, as its status and transcript are.
    work: {
      turns: planning.work,
      callLive: fixture === undefined ? live : reported.callPlanId === planning.activePlanId,
    },
    agents,
    onSelect: select,
    onShowAgent: (planId, agentId) => {
      if (planId !== planning.activePlanId) select(planId);
      sidePanel.onChoose({ agent: agentId });
    },
    repositories: {
      recent: recentRepositories(planning.plans),
      read: readRepositories,
      openGitHub,
    },
    repositoryMenu,
    onChangeRepository: changeRepository,
    onSetRepository: setRepository,
    onOpenOnGitHub: (planId) => {
      const repository = repositoryOf(planId);
      if (repository !== null) openGitHub(repositoryPageUrl(repository));
    },
    onRetryList: () => tell(ACT_KIND.PLANNING_REFRESH),
    onRetryDocument: () => {
      if (planning.activePlanId !== undefined) select(planning.activePlanId);
    },
    onNewPlan: () => {
      if (page === PLANS_PAGE.DOCUMENT) leavePlan();
      setNewPlanPresses((presses) => presses + 1);
    },
    newPlan: {
      presses: newPlanPresses,
      start: startPlan,
    },
    onLeavePlan: leavePlan,
    onRenamePlan: renamePlan,
    onDeletePlan: deletePlan,
    back,
  };
}
