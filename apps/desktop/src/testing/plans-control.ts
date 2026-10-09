import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../renderer/planning/planning-model";
import { TRANSCRIPT_REGION } from "../renderer/planning/transcript-model";
import type { CodingAgentsControl } from "../renderer/planning/use-coding-agents";
import type { PlansControl } from "../renderer/planning/use-plans-tab";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
} from "../renderer/planning/use-side-panel";

const ignore = () => undefined;

/** A plan with no agents and no repository, every press ignored. */
export function codingAgentsControl(
  overrides: Partial<CodingAgentsControl> = {},
): CodingAgentsControl {
  return {
    agents: [],
    agentIds: [],
    listFailed: false,
    onRetryList: ignore,
    models: undefined,
    readModels: ignore,
    readDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    writeDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    start: { available: false, reason: undefined, busy: false, note: undefined, onPress: ignore },
    onStop: () => Promise.resolve(),
    onMessage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onStatus: ignore,
    readTranscript: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readPullRequest: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
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
    activePlanId: undefined,
    boundFor: overrides.activePlanId,
    listFailed: false,
    region: { kind: DOCUMENT_REGION.NONE },
    copy: { shown: COPY_SHOWN.IDLE, onPress: ignore },
    microphone: { label: "Talk about this plan", enabled: true, muted: false, onPress: ignore },
    stop: { shown: false, onPress: ignore },
    status: undefined,
    live: false,
    sidePanel: {
      open: false,
      fullScreen: false,
      tabs: SIDE_PANEL_TABS,
      tab: SIDE_PANEL_TAB.BOARD,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      onToggle: ignore,
      onToggleFullScreen: ignore,
      onChoose: ignore,
      onAdd: ignore,
      onClose: ignore,
      onResize: ignore,
    },
    unreadTabs: [],
    board: undefined,
    code: undefined,
    transcript: { region: { kind: TRANSCRIPT_REGION.READING }, onRetry: ignore },
    work: { turns: undefined, callLive: false },
    agents: codingAgentsControl(),
    onSelect: ignore,
    onShowAgent: ignore,
    repositories: {
      recent: [],
      read: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
      openGitHub: ignore,
    },
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    onSetRepository: () => Promise.resolve(undefined),
    onOpenOnGitHub: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewPlan: ignore,
    newPlan: {
      presses: 0,
      start: () => Promise.resolve(undefined),
    },
    onLeavePlan: ignore,
    onRenamePlan: () => Promise.resolve(true),
    onDeletePlan: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    back: () => false,
    ...overrides,
  };
}
