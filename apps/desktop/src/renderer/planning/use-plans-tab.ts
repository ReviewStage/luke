import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningEditAnswer,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND, type ActResultFor } from "#shared/messages/acts";
import type { MicrophoneStatus } from "#shared/messages/audio";
import { callInProgress, VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { useCopyToast } from "../copy-feedback";
import { useChosenWorkspace } from "../desktop/chosen-workspace";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import { shownFiles } from "./code-pane-model";
import { agentTabLabel } from "./coding-agent-model";
import { dictationKeywords } from "./dictation-keywords";
import {
  FIXTURE_PLANNING_CALL,
  fixturePlanningView,
  fixtureRepositories,
  fixtureSidePanel,
} from "./planning-fixture";
import {
  archivedPlansNote,
  archivePlansFailedNote,
  type CallStatus,
  callStatus,
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  MARK_FAILED_NOTES,
  MARK_UNDOS,
  MICROPHONE_PRESS,
  markedView,
  microphoneButton,
  type PendingMarks,
  type PendingRenames,
  type PendingRepositoryPin,
  type PendingRepositoryPins,
  PLAN_MARK,
  PLANS_PAGE,
  type PlanMark,
  type PlansPage,
  pendingMark,
  pinnedRepositories,
  plansPage,
  REPOSITORY_PIN_FAILED_NOTES,
  recentRepositories,
  renamedView,
  repositoryFailureNote,
  repositoryPageUrl,
  sidebarPlans,
  unsettledMarks,
  unsettledRenames,
  unsettledRepositoryPins,
} from "./planning-model";
import type { RepositoryChooser } from "./repository-chip";
import { isAgentTab, type StripTab } from "./tab-strip-model";
import {
  type HeardCall,
  heardCalls,
  TRANSCRIPT_REGION,
  type TranscriptRegion,
  transcriptRegion,
} from "./transcript-model";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";
import { type MainTabsControl, useMainTabs } from "./use-main-tabs";
import { usePanelArrivals } from "./use-panel-arrivals";
import {
  type PlanHistoryControl,
  type PlanHistorySource,
  usePlanHistory,
} from "./use-plan-history";
import {
  type PinnedTab,
  type PlanHolds,
  SIDE_PANEL_TAB,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel";
import { startedAgentCallIds, workerCallIds } from "./work-model";

/**
 * use-plans-tab.ts -- the panel's Plans tab as one control: which page shows, the presses each page makes, and the host's read of the plans as the tab shows.
 *
 * The tab draws the planning view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * plan: the plan's notetaker writes the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename, a pin, and an
 * archive are the presses drawn before the host answers them: each shows at
 * once, and goes back if the service refuses it, a pin or an archive with a
 * quiet note on the plan's row. The open plan archived leaves for the
 * new-plan page once the service has kept the archive. The plan the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another plan, New plan, archiving it, a delete, or a
 * sign-out leaves it. With none open, the tab is the new-plan page. The open plan's
 * coding agents are the tab's too (`use-coding-agents.ts`): read when the
 * plan opens, started from the toolbar or the column's "+", and each drawn
 * on a tab of the plan's column beside the plan's own (`use-main-tabs.ts`),
 * their workers' in the side panel. Main is told which agent's tab is shown, so the notification it
 * posts when an agent ends is held back while the developer is looking at
 * that agent, and the agents main says ended unseen read in semibold until their
 * tab is shown (`main/agent-notices.ts`). The open plan's history is the
 * tab's as well (`use-plan-history.ts`): its version history, opened from
 * the plan's menu or its "Edited by" line, or from a section's on the
 * revision that last changed the section, takes the whole window in the
 * plan's place (`desktop-version-history.tsx`) until it is left or another
 * plan opens, and a version restored through the service is answered with
 * the window's toast. The side panel stands as it was behind it.
 */

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: PlansPage;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  /** The plans of the chosen workspace the sidebar lists, in its order: the pinned ones first, newest pinned first, then the rest, newest started first. */
  plans: PlanningView["plans"];
  /** The chosen workspace's archived plans, newest archived first, which the sidebar keeps under Archived. */
  archived: PlanningView["plans"];
  /** The workspaces the account is a member of, its personal one first; none before the first read lands. */
  workspaces: readonly Workspace[];
  /** The workspace the sidebar lists and New plan starts in; absent while none is listed, when every plan is listed. */
  workspace: Workspace | undefined;
  /** Lists another of the account's workspaces, and starts the next new plan in it. */
  onChooseWorkspace: (workspaceId: string) => void;
  /** Opens the service's Workspaces page in the browser, where workspaces are made and their members added. */
  onManageWorkspaces: () => void;
  activePlanId: string | undefined;
  /**
   * The plan the tab is on its way to: the one a press asked the host for,
   * until the host's open plan next moves, else the open one. Nothing is the
   * new-plan page, asked for or standing.
   */
  boundFor: string | undefined;
  listFailed: boolean;
  /** Whether the list drawn is one the service answered, rather than the empty one before the first read lands. */
  listRead: boolean;
  region: DocumentRegion;
  /** Copies the plan drawn as Markdown, answered with a toast, since its press stands in a menu. */
  copy: { onPress: () => void };
  /** Saves the developer's edit of one field of the open plan: saved, a conflict with what the field holds now, or why not. */
  edit: (planId: string, request: PlanEditRequest) => Promise<PlanningEditAnswer>;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  /** Silences Luke's voice on this Mac for the open plan's call, or plays it again; offered with the stop. */
  speaker: { muted: boolean; onPress: () => void };
  /** Ends the open plan's call at once, offered only while that call is in progress. */
  stop: { shown: boolean; onPress: () => void };
  /** The open plan's call status beside the microphone, absent while none stands. */
  status: CallStatus | undefined;
  /** Whether the open plan's call is in progress, so the plan is still being written. */
  live: boolean;
  /** The plan's column's tabs: the plan's own, then its agents' and its draft's, and which is shown. */
  mainTabs: MainTabsControl;
  /** The side panel beside the open plan's column: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents' tabs that ended unseen, each until it is shown. */
  unreadTabs: readonly StripTab[];
  /** The open plan's whiteboard as main holds it; absent before its first read lands. */
  board: Board | undefined;
  /** Every code Luke showed on the open plan, oldest first: what the service keeps, and each a call shows as it shows it. */
  shownCode: PlanningView["shownCode"];
  /** What was said on the open plan's calls, the call standing now included, and the retry of a read that failed. */
  transcript: { region: TranscriptRegion; onRetry: () => void };
  /**
   * What Luke's planning model wrote and ran on the open plan's calls,
   * whether its call still stands, the turn the page before the oldest drawn
   * is read before where an older one stands, and that read.
   */
  work: {
    turns: PlanningView["work"];
    callLive: boolean;
    earlier: string | undefined;
    onLoadEarlier: () => Promise<void>;
  };
  /** The open plan's coding agents: their tabs, the Start, and the Stop. */
  agents: CodingAgentsControl;
  /** The open plan's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  onSelect: (planId: string) => void;
  /** Opens a plan on one agent's tab: what a notification's click asks. */
  onShowAgent: (planId: string, agentId: string) => void;
  /** Opens a tab pinned to the sidebar: its plan, where it is not the open one, and the tab in its column, opening the side panel for one of its own. */
  onOpenPinnedTab: (pin: PinnedTab) => void;
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
  /** New plan with a repository already chosen in the page's composer: what a repository group's + asks. */
  onNewPlanIn: (repository: string) => void;
  /** What the new-plan page offers and the two presses it makes. */
  newPlan: {
    /** Counts the presses of New plan, so the page focuses its name field on each. */
    presses: number;
    /**
     * The repository the last press of New plan chose for the composer,
     * where it chose one; each press hands a new one, so the same
     * repository chosen twice is chosen again over what was picked between.
     */
    preset: { readonly repository: string } | undefined;
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
  /**
   * Pins or unpins a plan, archives it or brings it back, drawn at once and
   * put back with a note if the service refuses. Archiving the open plan
   * leaves it for the new-plan page, as deleting it does.
   */
  onMarkPlan: (planId: string, mark: PlanMark) => void;
  /**
   * Archives several plans at once, as a repository's Archive plans asks:
   * each drawn archived at once, and one toast for them all once the
   * service answered, whose Undo brings back every plan it kept.
   */
  onArchivePlans: (planIds: readonly string[]) => void;
  /** The repositories the account pinned in the sidebar, newest pinned first, whose groups stand above the rest. */
  pinnedRepositories: readonly string[];
  /** Pins a repository in the sidebar or unpins it, on the account: drawn at once, and put back with a toast if the service refuses. */
  onPinRepository: (repository: string, pinned: boolean) => void;
  /** Deletes a plan, which ends its call and returns to the new-plan page if it is the open one; answers whether it was deleted. */
  onDeletePlan: (planId: string) => Promise<ActionResult>;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, else an open
   * plan back to the new-plan page.
   */
  back: () => boolean;
}

/** The open plan's history as the window opens and draws it, over what is read of it. */
export interface VersionHistoryControl extends PlanHistoryControl {
  /** Whether the plan's version history takes the window in its place. */
  open: boolean;
  /**
   * Opens a plan's version history on the plan as it stands, or, given the
   * moment of a save, on the revision that made it, opening the plan first
   * where it is not the open one.
   */
  onOpen: (planId: string, save?: number) => void;
  /** Leaves the version history for the plan, its side panel as it was. */
  onClose: () => void;
}

/** The plan whose version history stands, and the save whose revision it opened on. */
interface HistoryOpening {
  readonly planId: string;
  readonly save: number | undefined;
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

/** No repository pin given here and still waiting on main's view. */
const NO_PENDING_PINS: PendingRepositoryPins = new Map();

/** What the toast says once Copy plan has put the plan on the clipboard. */
const PLAN_COPIED_NOTE = "Plan copied";

/** What the toast says once a plan is deleted. */
const PLAN_DELETED_NOTE = "Plan deleted";

/** Why a delete the service did not carry was refused. */
const DELETE_REFUSED_NOTE = "The plan could not be deleted. Try again.";

/** What the toast says once a version is restored, and why its Undo did nothing. */
const VERSION_RESTORED_NOTE = "Version restored";
const RESTORE_UNDO_REFUSED_NOTE = "The restore could not be undone. Try again.";

/** What a delete the service did not carry answers, so the plan stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_REFUSED_NOTE,
};

/** What the open plan holds of each fixed tab's kind, each unknown until its read lands: the transcript's calls are those heard on it too. */
function planHolds(
  view: Pick<PlanningView, "board" | "shownCode" | "work">,
  transcript: TranscriptRegion,
): PlanHolds {
  const { board, shownCode, work } = view;
  return {
    [SIDE_PANEL_TAB.BOARD]:
      board === undefined
        ? undefined
        : board.elements.length > 0 || (board.drawing?.elements.length ?? 0) > 0,
    [SIDE_PANEL_TAB.CODE]: shownCode === undefined ? undefined : shownCode.length > 0,
    [SIDE_PANEL_TAB.TRANSCRIPT]:
      transcript.kind === TRANSCRIPT_REGION.READY
        ? true
        : transcript.kind === TRANSCRIPT_REGION.EMPTY
          ? false
          : undefined,
    [SIDE_PANEL_TAB.WORK]: work === undefined ? undefined : work.length > 0,
  };
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
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const [newPlanPresses, setNewPlanPresses] = useState(0);
  const [newPlanPreset, setNewPlanPreset] = useState<PlansControl["newPlan"]["preset"]>(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<PlansControl["repositoryMenu"]>(undefined);
  const [asked, setAsked] = useState<PlanAsk | undefined>(undefined);
  /**
   * The plan whose version history stands in the window, which it does only
   * while that plan is the one bound for, and the save whose revision it
   * opened on, none for the plan as it stands.
   */
  const [historyFor, setHistoryFor] = useState<HistoryOpening | undefined>(undefined);

  // A fixture run draws its synthetic plans in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixturePlanningView(input.run);
  const viewed = fixture ?? input.planning;
  // A name given here stands until main's view carries it, so a rename that
  // landed never flickers back while main's copy of the view catches up.
  const [renames, setRenames] = useState<PendingRenames>(new Map());
  useEffect(() => setRenames((held) => unsettledRenames(held, viewed)), [viewed]);
  // A pin or an archive given here stands until main's view carries it, as a name does.
  const [marks, setMarks] = useState<PendingMarks>(new Map());
  useEffect(() => setMarks((held) => unsettledMarks(held, viewed)), [viewed]);
  // A repository's pin given here stands until main's view carries it, as a
  // plan's does. Note that a sign-out lets every one go, because a pin names
  // a repository rather than a row of this account's own, so one left
  // standing would be drawn on the next account to sign in.
  const [repositoryPins, setRepositoryPins] = useState<PendingRepositoryPins>(new Map());
  const accountSignedIn = input.signedIn;
  useEffect(
    () =>
      setRepositoryPins((held) =>
        accountSignedIn ? unsettledRepositoryPins(held, viewed.repositoryPins) : NO_PENDING_PINS,
      ),
    [viewed, accountSignedIn],
  );
  const planning = markedView(renamedView(viewed, renames), marks);
  // The sidebar, and the palette reading it, list the chosen workspace's
  // plans alone; with none listed yet, every plan stands as it did before.
  const workspace = useChosenWorkspace(viewed.workspaces, fixture !== undefined);
  const chosen = workspace.chosen;
  const sidebar = sidebarPlans(
    chosen === undefined
      ? planning.plans
      : planning.plans.filter((plan) => plan.workspaceId === chosen.id),
  );
  const signedIn = fixture !== undefined || input.signedIn;
  const page = plansPage(planning);
  const region = documentRegion(planning);
  // A started agent's tab opens selected; the column's tabs are built after
  // the agents they draw, so the opening reaches them through this late binding.
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = viewed.document.plan;
  // The open plan's own words, which a dictation into one of its agents' boxes listens for.
  const dictationWords = useMemo(
    () =>
      openDocument === undefined || openDocument.id !== viewed.activePlanId
        ? []
        : dictationKeywords({
            repository: openDocument.repository,
            title: openDocument.name,
            body: openDocument.document.body,
          }),
    [openDocument, viewed.activePlanId],
  );
  // A fixture's plans have no agents, as they are read from nowhere.
  const agents = useCodingAgents({
    acts: input.acts,
    planId: fixture === undefined ? viewed.activePlanId : undefined,
    repository:
      openDocument?.id === viewed.activePlanId ? (openDocument?.repository ?? null) : null,
    // Read through the marks, so an Unarchive opens the composers at once, as it does the document.
    archived: region.kind === DOCUMENT_REGION.READY && region.plan.archivedAt !== undefined,
    onUnarchive: () => {
      if (region.kind === DOCUMENT_REGION.READY)
        markNow.current(region.plan.id, PLAN_MARK.UNARCHIVE);
    },
    onStarted: (agentId) => mainRef.current?.onChoose({ agent: agentId }),
    keywords: dictationWords,
  });
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
        planId: viewed.activePlanId,
        now: Date.now(),
      }),
    );
  }, [reported.callPlanId, reported.callTranscript, viewed.activePlanId]);
  const transcript = transcriptRegion({
    transcript: viewed.transcript,
    heard,
    lukeEndedCall: voice.view.lukeEndedCall,
  });
  // A subagent's tab is held to the plan's work as an agent's is to its agents.
  const workers = useMemo(() => workerCallIds(viewed.work), [viewed.work]);
  // An agent Luke started in the call is in the work before it is in the
  // list, so the list is read again as its start answers, and the tab
  // appears as it does after a Start; a start already in the work when the
  // plan opens is read with the plan.
  const startedByLuke = useMemo(() => startedAgentCallIds(viewed.work), [viewed.work]);
  const startsSeen = useRef<{ planId: string | undefined; ids: ReadonlySet<string> }>({
    planId: undefined,
    ids: new Set(),
  });
  const readAgents = agents.onRetryList;
  useEffect(() => {
    const seen = startsSeen.current;
    const planId = viewed.activePlanId;
    const landed = seen.planId === planId && startedByLuke.some((callId) => !seen.ids.has(callId));
    startsSeen.current = { planId, ids: new Set(startedByLuke) };
    if (landed) readAgents();
  }, [startedByLuke, viewed.activePlanId, readAgents]);
  // A file's tab is held to the files Luke showed on the plan the same way.
  const files = useMemo(
    () => shownFiles(viewed.shownCode ?? []).map((ref) => ref.path),
    [viewed.shownCode],
  );
  const mainTabs = useMainTabs(
    fixture !== undefined,
    viewed.activePlanId,
    agents.agentIds,
    agents.draft?.id,
  );
  mainRef.current = mainTabs;
  const sidePanel = useSidePanel(
    fixtureSidePanel(input.run),
    { id: viewed.activePlanId, holds: planHolds(viewed, transcript) },
    mainTabs.openAgents,
    workers,
    files,
  );
  // An agent pinned to the sidebar is named there as its tab is named now,
  // so a pin made before the agent had its title, or before a rename,
  // catches up while its plan is open.
  const pinLabels = useMemo(
    () =>
      new Map(
        (agents.agents ?? []).map((agent) => [agent.id, agentTabLabel(agent, agents.models)]),
      ),
    [agents.agents, agents.models],
  );
  const { onRenamePins } = sidePanel;
  useEffect(() => {
    if (viewed.activePlanId !== undefined) onRenamePins(viewed.activePlanId, pinLabels);
  }, [viewed.activePlanId, pinLabels, onRenamePins]);
  // Main hears which agent's tab is on screen, and none while the tab is
  // away, the version history stands in the plan's place, the side panel
  // fills the window over the column, or the column shows something else; a
  // fixture's staged agents are no one's to announce.
  const shownAgent =
    shown &&
    historyFor === undefined &&
    fixture === undefined &&
    !sidePanel.fullScreen &&
    isAgentTab(mainTabs.tab)
      ? mainTabs.tab.agent
      : null;
  const reportedAgent = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reportedAgent.current === shownAgent) return;
    reportedAgent.current = shownAgent;
    tell(ACT_KIND.CODING_AGENTS_SHOWN, { agentId: shownAgent });
  }, [shownAgent, tell]);

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
  // The version history is the plan's, so another plan, or none, leaves it.
  if (historyFor !== undefined && historyFor.planId !== boundFor) setHistoryFor(undefined);
  const historyOpen = historyFor !== undefined && historyFor.planId === boundFor;
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

  // A fixture's plans are deleted nowhere, as they are read from nowhere. A
  // delete that landed says so in a toast, since its dialog has closed; a
  // refusal is said in the dialog that asked, unless the tab went away while
  // the delete was out and took the dialog with it.
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const deletePlan = async (planId: string): Promise<ActionResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await act(ACT_KIND.PLANNING_DELETE, { planId }).catch(() => false);
    if (deleted) {
      toast({ words: PLAN_DELETED_NOTE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    }
    if (!shownNow.current) {
      toast({ words: DELETE_REFUSED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    }
    return DELETE_REFUSED;
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

  // The open plan as it stands when an archive is answered, which may be
  // another than the one open when it was pressed.
  const openNow = useRef(openPlanId);
  openNow.current = openPlanId;

  // A fixture's plans are marked nowhere, as they are read from nowhere. A
  // refusal puts back the mark it drew only while no later press replaced it,
  // and says so in a toast, since the menu that asked has closed. An archive
  // that landed, or an unarchive, says so with an Undo, which marks the plan
  // back and opens it again if the archive had left it; an undoing says
  // nothing of its own unless it is refused. Note that the open plan is left
  // only once its archive is answered, because leaving ends its call, which a
  // refusal could not give back, nor can an Undo.
  const markPlan = (planId: string, mark: PlanMark, undoing?: { reopen: boolean }) => {
    if (fixture !== undefined) return;
    const next = { ...marks.get(planId), ...pendingMark(mark, Date.now()) };
    setMarks((held) => new Map(held).set(planId, next));
    const pinning = mark === PLAN_MARK.PIN || mark === PLAN_MARK.UNPIN;
    const asked = pinning
      ? act(ACT_KIND.PLANNING_PIN, { planId, pinned: mark === PLAN_MARK.PIN })
      : act(ACT_KIND.PLANNING_ARCHIVE, { planId, archived: mark === PLAN_MARK.ARCHIVE });
    asked
      .catch(() => false)
      .then((changed) => {
        if (!changed) {
          setMarks((held) =>
            held.get(planId) === next
              ? new Map([...held].filter(([pending]) => pending !== planId))
              : held,
          );
          toast({
            words: MARK_FAILED_NOTES[mark],
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          });
          return;
        }
        const left = mark === PLAN_MARK.ARCHIVE && openNow.current === planId;
        if (left) leavePlan();
        if (undoing?.reopen) selectNow.current(planId);
        if (pinning || undoing !== undefined) return;
        const { note, undo } = MARK_UNDOS[mark];
        toast({
          words: note,
          tone: TOAST_TONE.DONE,
          action: {
            label: UNDO_LABEL,
            onPress: () => markNow.current(planId, undo, { reopen: left }),
          },
        });
      });
  };
  // A fixture's repositories are pinned nowhere, as its plans are marked
  // nowhere. A pin says nothing once it lands, since the group it moves is
  // in sight; a refusal puts the group back only while no later press
  // replaced it, and says so in a toast, since the menu that asked has closed.
  const pinRepository = (repository: string, pinned: boolean) => {
    if (fixture !== undefined) return;
    const next: PendingRepositoryPin = { pinned, at: Date.now() };
    setRepositoryPins((held) => new Map(held).set(repository, next));
    act(ACT_KIND.PLANNING_PIN_REPOSITORY, { repository, pinned })
      .catch(() => false)
      .then((changed) => {
        if (changed) return;
        setRepositoryPins((held) =>
          held.get(repository) === next
            ? new Map([...held].filter(([pending]) => pending !== repository))
            : held,
        );
        toast({
          words: pinned ? REPOSITORY_PIN_FAILED_NOTES.PIN : REPOSITORY_PIN_FAILED_NOTES.UNPIN,
          tone: TOAST_TONE.FAILED,
          hold: TOAST_HOLD.FAILED,
        });
      });
  };

  // Several plans archived at once answer with one toast rather than one
  // each, so its Undo brings back every plan the service kept, and opens
  // again the open plan where the archive left it. A plan the service
  // refused goes back where it was, and the toast counts it.
  const archivePlans = (planIds: readonly string[]) => {
    if (fixture !== undefined || planIds.length === 0) return;
    const asked = planIds.map((planId) => ({
      planId,
      next: { ...marks.get(planId), ...pendingMark(PLAN_MARK.ARCHIVE, Date.now()) },
    }));
    setMarks(
      (held) => new Map([...held, ...asked.map(({ planId, next }) => [planId, next] as const)]),
    );
    const answers = asked.map(({ planId }) =>
      act(ACT_KIND.PLANNING_ARCHIVE, { planId, archived: true }).catch(() => false),
    );
    Promise.all(answers).then((changed) => {
      const refused = asked.filter((_, index) => !changed[index]);
      const landed = asked.filter((_, index) => changed[index]).map(({ planId }) => planId);
      setMarks(
        (held) =>
          new Map(
            [...held].filter(([pending, mark]) =>
              refused.every((each) => each.planId !== pending || each.next !== mark),
            ),
          ),
      );
      if (landed.length === 0) {
        toast({
          words: archivePlansFailedNote(refused.length),
          tone: TOAST_TONE.FAILED,
          hold: TOAST_HOLD.FAILED,
        });
        return;
      }
      const left = landed.find((planId) => planId === openNow.current);
      if (left !== undefined) leavePlan();
      toast({
        words: archivedPlansNote(landed.length, refused.length),
        tone: TOAST_TONE.DONE,
        action: {
          label: UNDO_LABEL,
          onPress: () => {
            for (const planId of landed) {
              markNow.current(planId, PLAN_MARK.UNARCHIVE, { reopen: planId === left });
            }
          },
        },
      });
    });
  };
  // An Undo is pressed renders after its archive landed, so it marks, and
  // opens, through the tab as it stands then rather than as it stood.
  const markNow = useRef(markPlan);
  markNow.current = markPlan;
  const selectNow = useRef(select);
  selectNow.current = select;

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(planMarkdown(region.plan.document), PLAN_COPIED_NOTE);
  };

  const microphone = microphoneButton({
    voiceAvailable: input.voiceAvailable,
    microphoneStatus: input.microphoneStatus,
    activePlanId: planning.activePlanId,
    archived: region.kind === DOCUMENT_REGION.READY && region.plan.archivedAt !== undefined,
    listening: voice.listening,
    callPlanId: voice.view.callPlanId,
    voiceStatus: voice.view.voiceStatus,
  });
  const live = callInProgress(voice.view) && voice.view.callPlanId === planning.activePlanId;
  // The press names no plan: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that plan or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) tell(ACT_KIND.PLANNING_TALK);
  };

  // A fixture's staged plan has nothing arriving on it, and code arrives
  // only on a call, since what a plan opens with it already held.
  const arrivedTabs = usePanelArrivals({
    planId: fixture === undefined ? planning.activePlanId : undefined,
    board: planning.board,
    code: live ? (planning.shownCode ?? []) : undefined,
    panel: sidePanel,
  });
  // An agent that ended unseen marks its tab unread as an arrival does; main
  // clears it once the tab is shown.
  const unreadTabs: readonly StripTab[] = [
    ...arrivedTabs,
    ...input.unseenAgents.map((agent) => ({ agent })),
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

  // A fixture's plans are read from nowhere, so an edit of one is never saved.
  const edit = (planId: string, request: PlanEditRequest): Promise<PlanningEditAnswer> => {
    if (fixture !== undefined) return Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED });
    return act(ACT_KIND.PLANNING_EDIT, { planId, edit: request });
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

  // A fixture's plan has no history, as it is read from nowhere.
  const historySource = useMemo(
    (): PlanHistorySource => ({
      readPage: (planId, before) =>
        act(ACT_KIND.PLANNING_REVISIONS, {
          planId,
          ...(before === undefined ? undefined : { before }),
        }),
      readRevision: (planId, seq) => act(ACT_KIND.PLANNING_REVISION, { planId, seq }),
      restore: (planId, seq) => act(ACT_KIND.PLANNING_RESTORE, { planId, seq }),
    }),
    [act],
  );
  const history = usePlanHistory({
    source: historySource,
    planId:
      fixture === undefined && region.kind === DOCUMENT_REGION.READY ? region.plan.id : undefined,
    editedAt: region.kind === DOCUMENT_REGION.READY ? region.plan.lastEdit?.at : undefined,
    name: region.kind === DOCUMENT_REGION.READY ? region.plan.name : undefined,
    shown: shown && historyOpen,
    seek: historyFor?.save,
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) =>
      toast(
        undo === undefined
          ? { words: VERSION_RESTORED_NOTE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE }
          : {
              words: VERSION_RESTORED_NOTE,
              tone: TOAST_TONE.DONE,
              action: {
                label: UNDO_LABEL,
                onPress: () => {
                  undo().then((undone) => {
                    if (undone) return;
                    toast({
                      words: RESTORE_UNDO_REFUSED_NOTE,
                      tone: TOAST_TONE.FAILED,
                      hold: TOAST_HOLD.FAILED,
                    });
                  });
                },
              },
            },
      ),
  });

  // A started plan becomes the host's open one, which turns the page to it.
  // It starts in the chosen workspace; with none listed the service starts
  // it in the account's personal one.
  const startPlan = (name: string, repository: string | null): Promise<string | undefined> =>
    act(ACT_KIND.PLANNING_START, {
      name,
      ...(repository === null ? undefined : { repository }),
      ...(chosen === undefined ? undefined : { workspaceId: chosen.id }),
    }).then(
      (answer) => ("failure" in answer ? repositoryFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );

  // A preset is for the visit it was pressed for: once a plan opens, a later
  // visit to the new-plan page starts on the composer's own choice again.
  useEffect(() => {
    if (page === PLANS_PAGE.DOCUMENT) setNewPlanPreset(undefined);
  }, [page]);

  // Each press of New plan is counted, so the page focuses its name field
  // again, and hands the repository it chose, if any, to the composer.
  const newPlanWith = (preset: PlansControl["newPlan"]["preset"]) => {
    if (page === PLANS_PAGE.DOCUMENT) leavePlan();
    setNewPlanPresses((presses) => presses + 1);
    setNewPlanPreset(preset);
  };

  // A plan's version history opens over the plan, so another plan opens first.
  const openHistory = (planId: string, save?: number) => {
    if (planId !== boundFor) select(planId);
    setHistoryFor({ planId, save });
  };

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
    plans: [...sidebar.pinned, ...sidebar.rest],
    archived: sidebar.archived,
    workspaces: viewed.workspaces,
    workspace: chosen,
    onChooseWorkspace: workspace.choose,
    // A fixture's workspaces are managed nowhere, as its plans are read from nowhere.
    onManageWorkspaces: () => {
      if (fixture === undefined) tell(ACT_KIND.WORKSPACES_MANAGE);
    },
    activePlanId: planning.activePlanId,
    boundFor,
    listFailed: planning.listStatus === PLANNING_READ.FAILED,
    listRead: planning.listStatus === PLANNING_READ.READY,
    region,
    copy: { onPress: pressCopy },
    edit,
    microphone: {
      label: microphone.label,
      enabled: microphone.press !== MICROPHONE_PRESS.NONE,
      muted: microphone.muted,
      onPress: pressMicrophone,
    },
    // The speaker is the voice window's to silence, since it plays Luke.
    speaker: {
      muted: voice.view.speakerMuted,
      onPress: () =>
        tell(ACT_KIND.VOICE_COMMAND, {
          command: voice.view.speakerMuted
            ? VOICE_COMMAND.UNMUTE_SPEAKER
            : VOICE_COMMAND.MUTE_SPEAKER,
        }),
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
    mainTabs,
    sidePanel,
    unreadTabs,
    board: planning.board,
    shownCode: planning.shownCode,
    transcript: {
      region: transcript,
      onRetry: () => tell(ACT_KIND.PLANNING_REFRESH),
    },
    // A fixture's open plan is drawn mid-call, as its status and transcript are.
    work: {
      turns: planning.work,
      callLive: fixture === undefined ? live : reported.callPlanId === planning.activePlanId,
      earlier: planning.workEarlier,
      onLoadEarlier: () => act(ACT_KIND.PLANNING_WORK_EARLIER),
    },
    agents,
    history: {
      ...history,
      open: historyOpen,
      onOpen: openHistory,
      onClose: () => setHistoryFor(undefined),
    },
    onSelect: select,
    // The agent's tab is in the plan's column, so a version history over it
    // gives way, and so does a side panel filling the window over it.
    onShowAgent: (planId, agentId) => {
      if (planId !== planning.activePlanId) select(planId);
      setHistoryFor(undefined);
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(planId, { agent: agentId });
    },
    // A pinned tab is in one of the plan's columns, so a version history over it gives way as well.
    onOpenPinnedTab: (pin) => {
      const { tab } = pin;
      if (pin.plan !== planning.activePlanId) select(pin.plan);
      setHistoryFor(undefined);
      if (!isAgentTab(tab)) {
        sidePanel.onShow(pin.plan, tab);
        return;
      }
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(pin.plan, tab);
    },
    repositories: {
      recent: recentRepositories(planning.plans),
      read: readRepositories,
      openGitHub,
      pictures: fixture === undefined,
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
    onNewPlan: () => newPlanWith(undefined),
    onNewPlanIn: (repository) => newPlanWith({ repository }),
    newPlan: {
      presses: newPlanPresses,
      preset: newPlanPreset,
      start: startPlan,
    },
    onLeavePlan: leavePlan,
    onRenamePlan: renamePlan,
    onMarkPlan: (planId, mark) => markPlan(planId, mark),
    onArchivePlans: archivePlans,
    pinnedRepositories: pinnedRepositories(viewed.repositoryPins, repositoryPins),
    onPinRepository: pinRepository,
    onDeletePlan: deletePlan,
    back,
  };
}
