import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningEditAnswer,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND, type ActResultFor } from "#shared/messages/acts";
import type { MicrophoneStatus } from "#shared/messages/audio";
import { VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { useCopyToast } from "../copy-feedback";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import { shownFiles } from "./code-pane-model";
import {
  FIXTURE_PLANNING_CALL,
  fixturePlanningView,
  fixtureRepositories,
  fixtureSidePanel,
} from "./planning-fixture";
import {
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
  PLAN_MARK,
  PLANS_PAGE,
  type PlanMark,
  type PlansPage,
  pendingMark,
  planningCallInProgress,
  plansPage,
  recentRepositories,
  renamedView,
  repositoryFailureNote,
  repositoryPageUrl,
  sidebarPlans,
  unsettledMarks,
  unsettledRenames,
} from "./planning-model";
import type { RepositoryChooser } from "./repository-chip";
import {
  type HeardCall,
  heardCalls,
  TRANSCRIPT_REGION,
  type TranscriptRegion,
  transcriptRegion,
} from "./transcript-model";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";
import { usePanelArrivals } from "./use-panel-arrivals";
import {
  type PlanHistoryControl,
  type PlanHistorySource,
  usePlanHistory,
} from "./use-plan-history";
import {
  isAgentTab,
  type PlanHolds,
  SIDE_PANEL_TAB,
  type SidePanelControl,
  type SidePanelTab,
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
 * plan opens, started from the toolbar, and each drawn on a tab of the side
 * panel. Main is told which agent's tab is shown, so the notification it
 * posts when an agent ends is held back while the developer is looking at
 * that agent, and the agents main says ended unseen wear a dot until their
 * tab is shown (`main/agent-notices.ts`). The open plan's history is the
 * tab's as well (`use-plan-history.ts`): read while its tab is on screen,
 * a version chosen there drawn in the document's place, and restored through
 * the service, answered with the window's toast.
 */

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: PlansPage;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  /** The plans the sidebar lists, in its order: the pinned ones first, newest pinned first, then the rest, newest started first. */
  plans: PlanningView["plans"];
  /** The archived plans, newest archived first, which the sidebar keeps under Archived. */
  archived: PlanningView["plans"];
  activePlanId: string | undefined;
  /**
   * The plan the tab is on its way to: the one a press asked the host for,
   * until the host's open plan next moves, else the open one. Nothing is the
   * new-plan page, asked for or standing.
   */
  boundFor: string | undefined;
  listFailed: boolean;
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
  /** The side panel beside the open plan's document: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents that ended unseen, each until it is shown. */
  unreadTabs: readonly SidePanelTab[];
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
  /** The open plan's history: its versions, the one drawn in the document's place, and its restore. */
  history: PlanHistoryControl;
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
  /** Deletes a plan, which ends its call and returns to the new-plan page if it is the open one; answers whether it was deleted. */
  onDeletePlan: (planId: string) => Promise<ActionResult>;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, a version
   * drawn in the document's place back to the plan as it stands, else an
   * open plan back to the new-plan page.
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

/**
 * What the open plan holds of each fixed tab's kind, each unknown until its
 * read lands: the transcript's calls are those heard on it too, and its
 * history any revision, which a plan with a last edit has.
 */
function planHolds(
  view: Pick<PlanningView, "board" | "shownCode" | "work" | "document">,
  transcript: TranscriptRegion,
): PlanHolds {
  const { board, shownCode, work } = view;
  const plan = view.document.plan;
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
    [SIDE_PANEL_TAB.HISTORY]: plan === undefined ? undefined : plan.lastEdit !== undefined,
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
  const sidePanel = useSidePanel(
    fixtureSidePanel(input.run),
    { id: viewed.activePlanId, holds: planHolds(viewed, transcript) },
    agents.agentIds,
    workers,
    agents.draft?.id,
    files,
  );
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
  // A pin or an archive given here stands until main's view carries it, as a name does.
  const [marks, setMarks] = useState<PendingMarks>(new Map());
  useEffect(() => setMarks((held) => unsettledMarks(held, viewed)), [viewed]);
  const planning = markedView(renamedView(viewed, renames), marks);
  const sidebar = sidebarPlans(planning.plans);
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

  // A fixture's staged plan has nothing arriving on it, and code arrives
  // only on a call, since what a plan opens with it already held.
  const arrivedTabs = usePanelArrivals({
    planId: fixture === undefined ? planning.activePlanId : undefined,
    board: planning.board,
    code: live ? (planning.shownCode?.length ?? 0) > 0 : undefined,
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

  // A fixture's plans are read from nowhere, so an edit of one is never saved.
  const edit = (planId: string, request: PlanEditRequest): Promise<PlanningEditAnswer> => {
    if (fixture !== undefined) return Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED });
    return act(ACT_KIND.PLANNING_EDIT, { planId, ...request });
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
    shown: shown && sidePanel.open && sidePanel.tab === SIDE_PANEL_TAB.HISTORY,
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
  const startPlan = (name: string, repository: string | null): Promise<string | undefined> =>
    act(ACT_KIND.PLANNING_START, {
      name,
      ...(repository === null ? undefined : { repository }),
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

  // The new-plan page is the tab's home, so only an open plan steps back,
  // and a panel filling the window over it is the nearer layer.
  const viewingVersion = history.viewing !== undefined;
  const back = useCallback((): boolean => {
    if (page !== PLANS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else if (viewingVersion) history.onBack();
    else leavePlan();
    return true;
  }, [
    leavePlan,
    page,
    sidePanel.fullScreen,
    sidePanel.onToggleFullScreen,
    viewingVersion,
    history.onBack,
  ]);

  return {
    page,
    shown,
    signedIn,
    plans: [...sidebar.pinned, ...sidebar.rest],
    archived: sidebar.archived,
    activePlanId: planning.activePlanId,
    boundFor,
    listFailed: planning.listStatus === PLANNING_READ.FAILED,
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
    history,
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
    onDeletePlan: deletePlan,
    back,
  };
}
