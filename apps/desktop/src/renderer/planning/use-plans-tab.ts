import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningEditAnswer,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND, type ActResultFor } from "#shared/messages/acts";
import type { AppInboxPlan, AppInboxPlanHolding } from "#shared/messages/app-state";
import type { MicrophoneStatus } from "#shared/messages/audio";
import { callInProgress, VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { callCard } from "../call/call-card-model";
import { useCopyToast } from "../copy-feedback";
import {
  DIALOG_TONE,
  type DialogConfirm,
  type DialogQuestion,
  useConfirmDialog,
} from "../settings/confirm-dialog";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import { shownFiles } from "./code-pane-model";
import { agentTabLabel } from "./coding-agent-model";
import { dictationKeywords } from "./dictation-keywords";
import { type InboxReadsControl, useInboxReads } from "./inbox-reads";
import { REVISION_SOURCE, type RevisionSource } from "./plan-history-model";
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
import { MAIN_TAB, type MainTab, type MainTabsControl, useMainTabs } from "./use-main-tabs";
import { usePanelArrivals } from "./use-panel-arrivals";
import {
  type HistorySpot,
  type PlanHistoryControl,
  type PlanHistorySource,
  usePlanHistory,
} from "./use-plan-history";
import {
  inColumn,
  type PinnedTab,
  type PlanHolds,
  SIDE_PANEL_TAB,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel";
import { sayRestored } from "./version-view";
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

/** A call or a turn the open plan's side panel is asked to bring into view, on the plan it was asked of. */
interface SourceReveal {
  readonly planId: string;
  readonly source: Exclude<RevisionSource, { kind: typeof REVISION_SOURCE.AGENT }>;
}

/**
 * The window's Inbox, standing in the plan's place beside the sidebar: the
 * plans holding inbox items in a column of their own, and the chosen plan's
 * items beside them. It is the window's alone, as a version history is, so
 * it leaves the plan the host has open, and the call bound to it, as they
 * stand; opening any plan, or a new one, leaves it.
 */
export interface InboxViewControl {
  readonly open: boolean;
  /** The plan chosen in it, none until one is, where the list's first stands in. */
  readonly planId: string | undefined;
  /** Whether it lists only the plans with an item the developer has not seen. */
  readonly unreadOnly: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (planId: string) => void;
  readonly onUnreadOnly: (unreadOnly: boolean) => void;
}

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
  /** Whether the list drawn is one the service answered, rather than the empty one before the first read lands. */
  listRead: boolean;
  region: DocumentRegion;
  /** Copies the plan drawn as Markdown, answered with a toast, since its press stands in a menu. */
  copy: { onPress: () => void };
  /** Saves the developer's edit of the open plan's document: saved, a conflict with the text as it stands now, or why not. */
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
  /** The pages agents wrote for the open plan, each by its newest version; absent with none. */
  pages: PlanningView["pages"];
  /** What was said on the open plan's calls, the call standing now included, and the retry of a read that failed. */
  transcript: {
    region: TranscriptRegion;
    onRetry: () => void;
    /** The call the tab is asked to bring into view, by its key, and the word that it has; what a version's Open asks. */
    reveal?: { readonly call: string; readonly onRevealed: () => void } | undefined;
  };
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
    /** The moment whose turn the tab is asked to bring into view, and the word that it has; what a version's Open asks. */
    reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
  };
  /** The open plan's coding agents: their tabs, the Start, and the Stop. */
  agents: CodingAgentsControl;
  /** The open plan's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  onSelect: (planId: string) => void;
  /** Opens a plan on one agent's tab: what a notification's click asks. */
  onShowAgent: (planId: string, agentId: string) => void;
  /** Leaves the version history for the place that wrote a version: its agent's tab, its call in the Transcript, or its turn in Work. */
  onShowSource: (planId: string, source: RevisionSource) => void;
  /** The question a Talk press or a start asks before it ends the call standing about another plan. */
  secondCall: { confirm: DialogConfirm; question: DialogQuestion };
  /** Opens a plan on its own document tab, out from under its version history and a side panel filling the window: the call card's way back. */
  onShowPlan: (planId: string) => void;
  /** Opens a plan on its Inbox tab the same way, opening the tab where it was closed: what ⌘K's Inbox row asks. */
  onShowInbox: (planId: string) => void;
  /** What waits on the developer across the account's plans, as main's read last answered: each plan with an open inbox item, and its items. */
  inbox: readonly AppInboxPlan[];
  /** The plan whose Inbox is on screen, or none: what main is told, so an item it shows is not announced. */
  inboxShown: string | null;
  /** Every plan holding an inbox item, waiting or settled, the plan whose item changed latest first: what the window's Inbox lists. */
  inboxPlans: readonly AppInboxPlanHolding[];
  /** Which waiting items each plan has shown on this Mac: the Inbox's unread dots and counts, and the press that marks them read. */
  inboxReads: InboxReadsControl;
  /** The window's Inbox: whether it stands in the plan's place, the plan chosen in it, and its presses. */
  inboxView: InboxViewControl;
  /** Opens a plan's file in its side panel at the commit named, the reference's lines lit, opening the plan first where it is not the open one: what an inbox item's code opens. */
  onShowFile: (planId: string, ref: CodeRef, commit: string) => void;
  /** Opens a tab pinned to the sidebar: its plan, where it is not the open one, and the tab in its column, opening the side panel for one of its own. */
  onOpenPinnedTab: (pin: PinnedTab) => void;
  /** The pin the open plan was last opened from, which the sidebar marks in the plan's place for as long as the plan stays open; none once a plan is opened otherwise. */
  chosenPin: PinnedTab | undefined;
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
   * Draws a name being typed for a plan everywhere the plan is named, before
   * any of it is saved, or none, which draws its saved name again.
   */
  onDraftName: (planId: string, name: string | undefined) => void;
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
  /** Opens a plan's version history where it stood when it was left, as Back and Forward go to it. */
  onReturn: (planId: string, spot: HistorySpot | undefined) => void;
  /** Leaves the version history for the plan, its side panel as it was. */
  onClose: () => void;
}

/** The plan whose version history stands, and the save whose revision it opened on or where it stood before. */
interface HistoryOpening {
  readonly planId: string;
  readonly save: number | undefined;
  readonly spot: HistorySpot | undefined;
}

/** A pin pressed in the sidebar, and the plan open when it was, or its own once that opens. */
interface PinChoice {
  readonly pin: PinnedTab;
  readonly over: string | undefined;
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

/** What a delete the service did not carry answers, so the plan stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_REFUSED_NOTE,
};

/** What the second call's question says: the call it ends, and what the act does. */
function secondCallQuestion(planName: string): DialogQuestion {
  return {
    title: `End your call on ${planName} and start one here?`,
    body: "Only one plan is talked through at a time. What was said on that call stays in its transcript.",
    verb: "Start new call",
    running: "Starting",
    tone: DIALOG_TONE.PRIMARY,
  };
}

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
  /** What main says waits on the developer across the account's plans. */
  inboxWaiting: readonly AppInboxPlan[];
  /** Every plan main says holds an inbox item, waiting or settled. */
  inboxPlans: readonly AppInboxPlanHolding[];
  voice: {
    view: VoiceView;
    listening: boolean;
    requestMicrophoneAccess: () => void;
  };
  /** Opens Settings on its Integrations page, where an agent's MCP server is connected. */
  onOpenIntegrations: () => void;
}): PlansControl {
  const { shown, voice } = input;
  const { act, tell } = input.acts;
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const [newPlanPresses, setNewPlanPresses] = useState(0);
  const [newPlanPreset, setNewPlanPreset] = useState<PlansControl["newPlan"]["preset"]>(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<PlansControl["repositoryMenu"]>(undefined);
  const [asked, setAsked] = useState<PlanAsk | undefined>(undefined);
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  /**
   * The plan whose version history stands in the window, which it does only
   * while that plan is the one bound for, and the save whose revision it
   * opened on, none for the plan as it stands.
   */
  const [historyFor, setHistoryFor] = useState<HistoryOpening | undefined>(undefined);
  /** The window's Inbox while it stands: the plan chosen in it, and whether it lists only the unread. */
  const [inboxView, setInboxView] = useState<
    { readonly planId: string | undefined; readonly unreadOnly: boolean } | undefined
  >(undefined);
  /** A file an inbox item opens on a plan not yet open, opened once the host has it open. */
  const [fileFor, setFileFor] = useState<
    { readonly planId: string; readonly ref: CodeRef; readonly commit: string } | undefined
  >(undefined);
  const [reveal, setReveal] = useState<SourceReveal | undefined>(undefined);

  // A fixture run draws its synthetic plans in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixturePlanningView(input.run);
  const viewed = fixture ?? input.planning;
  // A name given here stands until main's view carries it, so a rename that
  // landed never flickers back while main's copy of the view catches up.
  const [renames, setRenames] = useState<PendingRenames>(new Map());
  useEffect(() => setRenames((held) => unsettledRenames(held, viewed)), [viewed]);
  // A name being typed is drawn over both, held here rather than read back
  // from main, so every surface naming the plan follows the typing at once.
  const [drafts, setDrafts] = useState<PendingRenames>(new Map());
  const draftName = useCallback((planId: string, name: string | undefined) => {
    setDrafts((held) => {
      if (held.get(planId) === name) return held;
      const next = new Map(held);
      if (name === undefined) next.delete(planId);
      else next.set(planId, name);
      return next;
    });
  }, []);
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
  const planning = markedView(renamedView(renamedView(viewed, renames), drafts), marks);
  const sidebar = sidebarPlans(planning.plans);
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
    onOpenIntegrations: input.onOpenIntegrations,
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
    input.inboxWaiting.some((plan) => plan.planId === viewed.activePlanId),
    agents.heldIds,
  );
  mainRef.current = mainTabs;
  // A page's tab is held to the pages agents wrote for the plan.
  const pages = useMemo(() => (viewed.pages ?? []).map((page) => page.id), [viewed.pages]);
  const sidePanel = useSidePanel(
    fixtureSidePanel(input.run),
    { id: viewed.activePlanId, holds: planHolds(viewed, transcript) },
    mainTabs.openAgents,
    workers,
    files,
    pages,
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
  // Main hears which agent's tab, or which plan's Inbox, is on screen, and
  // neither while the tab is away, the version history stands in the plan's
  // place, the side panel fills the window over the column, or the column
  // shows something else; a fixture's staged agents are no one's to announce.
  // The window's Inbox shows the plan chosen in it.
  // The window's Inbox stands in the column's place, showing the plan chosen there.
  const columnShown =
    shown &&
    historyFor === undefined &&
    inboxView === undefined &&
    fixture === undefined &&
    !sidePanel.fullScreen;
  const shownAgent = columnShown && isAgentTab(mainTabs.tab) ? mainTabs.tab.agent : null;
  const shownInbox =
    shown && fixture === undefined && inboxView !== undefined
      ? (inboxView.planId ?? null)
      : columnShown && mainTabs.tab === MAIN_TAB.INBOX
        ? (viewed.activePlanId ?? null)
        : null;
  const reportedTab = useRef<{ agentId: string | null; inboxPlanId: string | null } | undefined>(
    undefined,
  );
  useEffect(() => {
    const was = reportedTab.current;
    if (was?.agentId === shownAgent && was.inboxPlanId === shownInbox) return;
    reportedTab.current = { agentId: shownAgent, inboxPlanId: shownInbox };
    tell(ACT_KIND.CODING_AGENTS_SHOWN, { agentId: shownAgent, inboxPlanId: shownInbox });
  }, [shownAgent, shownInbox, tell]);

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
  // A reveal is the open plan's, so another plan opening drops it, and
  // coming back asks nothing of the visit after.
  if (reveal !== undefined && reveal.planId !== boundFor) setReveal(undefined);
  const revealing = reveal !== undefined && reveal.planId === boundFor ? reveal.source : undefined;
  // A pin stays chosen while its plan stays open, whichever of its tabs is
  // shown: once its plan opens it is held there, and any other plan opening
  // lets it go. Note that this reads the plan open rather than the one asked
  // for, because an ask the host refuses leaves the pin chosen.
  if (chosen !== undefined && openPlanId !== chosen.over) {
    setChosen(openPlanId === chosen.pin.plan ? { pin: chosen.pin, over: openPlanId } : undefined);
  }
  // An answer clears the ask it answers, never one made since.
  const revealed = () => setReveal((held) => (held === reveal ? undefined : held));
  // Opening a plan, or leaving one, is leaving the window's Inbox for it.
  const select = useCallback(
    (planId: string) => {
      setInboxView(undefined);
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
    setInboxView(undefined);
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
  // refused goes back where it was, and the toast counts it. Note that the
  // plans share one stamp, because they were archived by one press, so they
  // stand under Archived in the order they were listed rather than in an
  // order set by whether the clock ticked between two of them.
  const archivePlans = (planIds: readonly string[]) => {
    if (fixture !== undefined || planIds.length === 0) return;
    const at = Date.now();
    const asked = planIds.map((planId) => ({
      planId,
      next: { ...marks.get(planId), ...pendingMark(PLAN_MARK.ARCHIVE, at) },
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
    copyWithToast(planMarkdown(region.plan), PLAN_COPIED_NOTE);
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
  // A press that would open a call here while one stands about another plan
  // ends that call, so it asks first; the answer is the same Talk press, and
  // Cancel leaves the call standing as it was. The talk key never asks: it
  // speaks into the call standing, whatever plan is open. The question is the
  // plan's it was asked on, so it goes the moment another plan opens (the
  // press would talk about whichever plan the host has open), and its surface
  // is the plan's page, which a version history covers.
  const callElsewhere =
    callInProgress(voice.view) && voice.view.callPlanId !== planning.activePlanId;
  const [askedFor, setAskedFor] = useState<string>();
  const secondCallFor = callElsewhere && askedFor !== undefined ? askedFor : undefined;
  const secondCall = useConfirmDialog(
    { subject: secondCallFor === planning.activePlanId, surfaceOpen: shown && !historyOpen },
    () =>
      act(ACT_KIND.PLANNING_TALK).then(
        (): ActionResult => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
        (refused: Error): ActionResult => ({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: refused.message,
        }),
      ),
  );
  // A started plan asks once it is the plan open, which the host may say
  // only after the start's own answer has come back.
  const askOnOpen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (askOnOpen.current === undefined || askOnOpen.current !== secondCallFor) return;
    if (secondCallFor !== planning.activePlanId) return;
    askOnOpen.current = undefined;
    secondCall.ask();
  });
  const callingNow = useRef(callElsewhere);
  callingNow.current = callElsewhere;
  // The press names no plan: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that plan or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) {
      if (!callElsewhere) tell(ACT_KIND.PLANNING_TALK);
      else {
        setAskedFor(planning.activePlanId);
        secondCall.ask();
      }
    }
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
    returnTo: historyFor?.spot,
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) => sayRestored(toast, undo),
  });

  // A started plan becomes the host's open one, which turns the page to it.
  // A start opens its plan's call at once, except over a call standing about
  // another plan, which main leaves for this question to end or keep.
  const startPlan = (name: string, repository: string | null): Promise<string | undefined> =>
    act(ACT_KIND.PLANNING_START, {
      name,
      ...(repository === null ? undefined : { repository }),
    }).then(
      (answer) => {
        if ("failure" in answer) return repositoryFailureNote(answer.failure);
        if (callingNow.current) {
          askOnOpen.current = answer.planId;
          setAskedFor(answer.planId);
        }
        return undefined;
      },
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
    // The new-plan page stands under the Inbox too, so a press there leaves it.
    setInboxView(undefined);
    if (page === PLANS_PAGE.DOCUMENT) leavePlan();
    setNewPlanPresses((presses) => presses + 1);
    setNewPlanPreset(preset);
  };

  // A plan's version history opens over the plan, so another plan opens first.
  const openHistory = (opening: HistoryOpening) => {
    if (opening.planId !== boundFor) select(opening.planId);
    setInboxView(undefined);
    setHistoryFor(opening);
  };

  // A plan's own tab, its Inbox, and an agent's are in its column, so a
  // version history over it gives way, and so does a side panel filling the
  // window over it.
  const showColumnTab = (planId: string, tab: MainTab) => {
    if (planId !== planning.activePlanId) select(planId);
    setInboxView(undefined);
    setHistoryFor(undefined);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(planId, tab);
  };

  // An inbox item's code opens in its plan's File tab; on a plan not yet
  // open, once the host has it open, since the panel draws the open plan's.
  const showFile = (planId: string, ref: CodeRef, commit: string) => {
    setInboxView(undefined);
    setHistoryFor(undefined);
    if (planId === planning.activePlanId) {
      sidePanel.onOpenFile(ref, commit);
      return;
    }
    select(planId);
    setFileFor({ planId, ref, commit });
  };
  // A file asked for is the plan's it was asked on, so a select refused, or
  // another plan asked for since, lets it go.
  if (fileFor !== undefined && fileFor.planId !== boundFor) setFileFor(undefined);
  const { onOpenFile } = sidePanel;
  useEffect(() => {
    if (fileFor === undefined || fileFor.planId !== planning.activePlanId) return;
    setFileFor(undefined);
    onOpenFile(fileFor.ref, fileFor.commit);
  }, [fileFor, planning.activePlanId, onOpenFile]);
  const inboxReads = useInboxReads(input.inboxWaiting, input.inboxPlans, fixture !== undefined);

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
    pages: planning.pages,
    transcript: {
      region: transcript,
      onRetry: () => tell(ACT_KIND.PLANNING_REFRESH),
      reveal:
        revealing?.kind === REVISION_SOURCE.CALL
          ? { call: revealing.callId, onRevealed: revealed }
          : undefined,
    },
    // A fixture's open plan is drawn mid-call, as its status and transcript are.
    work: {
      turns: planning.work,
      callLive: fixture === undefined ? live : reported.callPlanId === planning.activePlanId,
      earlier: planning.workEarlier,
      onLoadEarlier: () => act(ACT_KIND.PLANNING_WORK_EARLIER),
      reveal:
        revealing?.kind === REVISION_SOURCE.WORK
          ? { at: revealing.at, onRevealed: revealed }
          : undefined,
    },
    agents,
    history: {
      ...history,
      open: historyOpen,
      onOpen: (planId, save) => openHistory({ planId, save, spot: undefined }),
      onReturn: (planId, spot) => openHistory({ planId, save: undefined, spot }),
      onClose: () => setHistoryFor(undefined),
    },
    // Note that the pin's own plan opened by its row is the plan the
    // sidebar marks again rather than the pin; another plan's lets the pin
    // go only once it opens.
    onSelect: (planId) => {
      setChosen((held) => (held?.pin.plan === planId ? undefined : held));
      select(planId);
    },
    onShowAgent: (planId, agentId) => showColumnTab(planId, { agent: agentId }),
    inbox: input.inboxWaiting,
    inboxShown: shownInbox,
    inboxPlans: input.inboxPlans,
    inboxReads,
    // The window's Inbox stands over the plan's place, so a version history there gives way.
    inboxView: {
      open: inboxView !== undefined,
      planId: inboxView?.planId,
      unreadOnly: inboxView?.unreadOnly ?? false,
      onOpen: () => {
        setHistoryFor(undefined);
        setInboxView((held) => held ?? { planId: undefined, unreadOnly: false });
      },
      onClose: () => setInboxView(undefined),
      onChoose: (planId) => setInboxView((held) => held && { ...held, planId }),
      onUnreadOnly: (unreadOnly) => setInboxView((held) => held && { ...held, unreadOnly }),
    },
    onShowFile: showFile,
    // A version's Open lands where its writer wrote it: an agent's tab as a
    // notification opens it, or the side panel's Transcript or Work, asked to
    // bring the call or the turn into view once it draws.
    onShowSource: (planId, source) => {
      if (source.kind === REVISION_SOURCE.AGENT) {
        showColumnTab(planId, { agent: source.agentId });
        return;
      }
      setInboxView(undefined);
      setHistoryFor(undefined);
      setReveal({ planId, source });
      sidePanel.onShow(
        planId,
        source.kind === REVISION_SOURCE.CALL ? SIDE_PANEL_TAB.TRANSCRIPT : SIDE_PANEL_TAB.WORK,
      );
    },
    // The call card's way back lands where the plan's call bar is in sight.
    secondCall: {
      confirm: secondCall,
      question: secondCallQuestion(callCard({ view: voice.view, planning }).planName),
    },
    onShowPlan: (planId) => showColumnTab(planId, MAIN_TAB.PLAN),
    onShowInbox: (planId) => showColumnTab(planId, MAIN_TAB.INBOX),
    // A pinned tab is in one of the plan's columns, so a version history over it gives way as well.
    onOpenPinnedTab: (pin) => {
      const { tab } = pin;
      setChosen({ pin, over: openPlanId });
      if (pin.plan !== planning.activePlanId) select(pin.plan);
      setInboxView(undefined);
      setHistoryFor(undefined);
      if (!inColumn(tab)) {
        sidePanel.onShow(pin.plan, tab);
        return;
      }
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(pin.plan, tab);
    },
    chosenPin: chosen !== undefined && chosen.pin.plan === boundFor ? chosen.pin : undefined,
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
    onDraftName: draftName,
    onMarkPlan: (planId, mark) => markPlan(planId, mark),
    onArchivePlans: archivePlans,
    pinnedRepositories: pinnedRepositories(viewed.repositoryPins, repositoryPins),
    onPinRepository: pinRepository,
    onDeletePlan: deletePlan,
    back,
  };
}
