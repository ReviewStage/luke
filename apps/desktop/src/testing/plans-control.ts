import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { SummaryPin } from "../renderer/desktop/plan-summary";
import { DOCUMENT_REGION, PLANS_PAGE } from "../renderer/planning/planning-model";
import { TRANSCRIPT_REGION } from "../renderer/planning/transcript-model";
import type { CodingAgentsControl } from "../renderer/planning/use-coding-agents";
import { MAIN_TAB } from "../renderer/planning/use-main-tabs";
import { HISTORY_READ } from "../renderer/planning/use-plan-history";
import type { PlansControl, VersionHistoryControl } from "../renderer/planning/use-plans-tab";
import {
  type OpenPlan,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
} from "../renderer/planning/use-side-panel";
import { CONFIRM_STAGE } from "../renderer/settings/confirm-state";

const ignore = () => undefined;

/** An open plan that has used every fixed tab, so its panel draws them all. */
export function usedPlan(id: string): OpenPlan {
  return {
    id,
    holds: {
      [SIDE_PANEL_TAB.BOARD]: true,
      [SIDE_PANEL_TAB.CODE]: true,
      [SIDE_PANEL_TAB.TRANSCRIPT]: true,
      [SIDE_PANEL_TAB.WORK]: true,
    },
  };
}

/** The plan's summary unpinned, its press ignored, so a page drawn over it draws the summary as its narrow rail of glyphs. */
export const UNPINNED_SUMMARY: SummaryPin = {
  pinned: false,
  onToggle: ignore,
  wide: true,
  onMeasured: ignore,
};

/** A plan whose version history is shut, its history still being read, no version chosen, every press ignored. */
export function versionHistoryControl(
  overrides: Partial<VersionHistoryControl> = {},
): VersionHistoryControl {
  return {
    open: false,
    onOpen: ignore,
    onReturn: ignore,
    onClose: ignore,
    list: { kind: HISTORY_READ.READING },
    selected: undefined,
    viewing: undefined,
    onSelect: ignore,
    spot: undefined,
    onOpenSections: ignore,
    onChooseSection: ignore,
    onCloseSections: ignore,
    onRetry: ignore,
    onLoadEarlier: () => Promise.resolve(false),
    onRestore: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    ...overrides,
  };
}

/** A plan with no agents and no repository, every press ignored. */
export function codingAgentsControl(
  overrides: Partial<CodingAgentsControl> = {},
): CodingAgentsControl {
  return {
    agents: [],
    archived: [],
    agentIds: [],
    // A plan with no archived agent holds exactly the agents given.
    heldIds: overrides.agentIds ?? [],
    keywords: [],
    readSkills: undefined,
    draft: undefined,
    onNewDraft: () => "draft",
    onDraftChange: ignore,
    onDraftAttachments: ignore,
    onDiscardDraft: ignore,
    startTask: () => Promise.resolve(undefined),
    listFailed: false,
    onRetryList: ignore,
    models: undefined,
    readModels: ignore,
    readDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    writeDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onUnarchive: undefined,
    start: { available: false, reason: undefined, busy: false, note: undefined, onPress: ignore },
    onStop: () => Promise.resolve(),
    onMessage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onChoose: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onSwitchServers: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onOpenIntegrations: ignore,
    onRename: () => Promise.resolve(false),
    onArchive: () => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }),
    // An agent read again stands as the control's list has it.
    readAgent: (agentId) =>
      Promise.resolve(
        [...(overrides.agents ?? []), ...(overrides.archived ?? [])].find(
          (agent) => agent.id === agentId,
        ),
      ),
    onStatus: ignore,
    onTitle: ignore,
    readTranscript: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readPullRequest: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readChanges: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    answerInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
  };
}

/**
 * A signed-in Plans tab on screen on its new-plan page with no plans, every
 * press ignored, bound for whichever plan it is given as open.
 */
export function plansControl(overrides: Partial<PlansControl> = {}): PlansControl {
  return {
    page: PLANS_PAGE.NEW,
    shown: true,
    signedIn: true,
    plans: [],
    archived: [],
    listed: { plans: overrides.plans ?? [], archived: overrides.archived ?? [] },
    workspaces: [],
    workspace: undefined,
    onChooseWorkspace: ignore,
    onLeftWorkspace: ignore,
    onCreateWorkspace: () => Promise.resolve(undefined),
    onInviteToWorkspace: ignore,
    onConnectGitHub: ignore,
    github: undefined,
    onConnectAccountGitHub: ignore,
    onDisconnectAccountGitHub: ignore,
    activePlanId: undefined,
    boundFor: overrides.activePlanId,
    listFailed: false,
    listRead: true,
    region: { kind: DOCUMENT_REGION.NONE },
    copy: { onPress: ignore },
    edit: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
    microphone: { label: "Talk about this plan", enabled: true, muted: false, onPress: ignore },
    speaker: { muted: false, onPress: ignore },
    stop: { shown: false, onPress: ignore },
    status: undefined,
    live: false,
    mainTabs: {
      tabs: [MAIN_TAB.PLAN],
      tab: MAIN_TAB.PLAN,
      openAgents: undefined,
      newTabAsked: false,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onInboxRead: ignore,
      onMove: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
    },
    sidePanel: {
      open: false,
      fullScreen: false,
      newTabAsked: false,
      tabs: SIDE_PANEL_TABS,
      order: [],
      closedTabs: [],
      used: SIDE_PANEL_TABS,
      pins: [],
      subagents: [],
      files: [],
      changes: [],
      tab: SIDE_PANEL_TAB.BOARD,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      onToggle: ignore,
      onToggleFullScreen: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onMove: ignore,
      onPin: ignore,
      onUnpin: ignore,
      onRenamePins: ignore,
      onOpenFile: ignore,
      onBrowseFile: ignore,
      onFileHistory: ignore,
      onFoldNote: ignore,
      onResize: ignore,
    },
    unreadTabs: [],
    board: undefined,
    shownCode: undefined,
    transcript: { region: { kind: TRANSCRIPT_REGION.READING }, onRetry: ignore },
    work: {
      turns: undefined,
      callLive: false,
      earlier: undefined,
      onLoadEarlier: () => Promise.resolve(),
    },
    agents: codingAgentsControl(),
    history: versionHistoryControl(),
    onSelect: ignore,
    onShowAgent: ignore,
    onShowSource: ignore,
    onShowPlan: ignore,
    onShowInbox: ignore,
    secondCall: {
      confirm: {
        stage: CONFIRM_STAGE.RESTING,
        rejection: undefined,
        busy: false,
        ask: ignore,
        keep: ignore,
        clear: ignore,
        run: ignore,
        standing: false,
      },
      question: { title: "", body: "", verb: "", running: "" },
    },
    inbox: [],
    inboxShown: null,
    inboxPlans: [],
    inboxReads: { unread: () => 0, total: 0, onSeen: ignore },
    inboxView: {
      open: false,
      planId: undefined,
      unreadOnly: false,
      onOpen: ignore,
      onClose: ignore,
      onChoose: ignore,
      onUnreadOnly: ignore,
    },
    onShowFile: ignore,
    onOpenPinnedTab: ignore,
    chosenPin: undefined,
    repositories: {
      recent: [],
      read: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
      openGitHub: ignore,
      connectGitHub: ignore,
      pictures: true,
    },
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    onSetRepository: () => Promise.resolve(undefined),
    onOpenOnGitHub: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewPlan: ignore,
    onNewPlanIn: ignore,
    newPlan: {
      presses: 0,
      preset: undefined,
      start: () => Promise.resolve(undefined),
    },
    onLeavePlan: ignore,
    onRenamePlan: () => Promise.resolve(true),
    onDraftName: ignore,
    onMarkPlan: ignore,
    onArchivePlans: ignore,
    pinnedRepositories: [],
    onPinRepository: ignore,
    onDeletePlan: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    back: () => false,
    ...overrides,
  };
}
