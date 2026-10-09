import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../renderer/planning/planning-model";
import { TRANSCRIPT_REGION } from "../renderer/planning/transcript-model";
import type { PlansControl } from "../renderer/planning/use-plans-tab";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
} from "../renderer/planning/use-side-panel";

const ignore = () => undefined;

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
    folders: {},
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
    onSelect: ignore,
    onChooseFolder: ignore,
    onRevealFolder: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewPlan: ignore,
    newPlan: {
      presses: 0,
      recentFolders: [],
      pickFolder: () => Promise.resolve(null),
      start: () => Promise.resolve(undefined),
    },
    onLeavePlan: ignore,
    onRenamePlan: () => Promise.resolve(true),
    onDeletePlan: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    back: () => false,
    ...overrides,
  };
}
