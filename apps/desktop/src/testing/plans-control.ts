import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../renderer/planning/planning-model";
import type { PlansControl } from "../renderer/planning/use-plans-tab";
import { SIDE_PANEL_TAB, SIDE_PANEL_WIDTH } from "../renderer/planning/use-side-panel";

const ignore = () => undefined;

/** A signed-in Plans tab on screen on its list page with no plans, every press ignored. */
export function plansControl(overrides: Partial<PlansControl> = {}): PlansControl {
  return {
    page: PLANS_PAGE.LIST,
    shown: true,
    signedIn: true,
    plans: [],
    folders: {},
    activePlanId: undefined,
    listFailed: false,
    region: { kind: DOCUMENT_REGION.NONE },
    copy: { shown: COPY_SHOWN.IDLE, onPress: ignore },
    microphone: { label: "Talk about this plan", enabled: true, muted: false, onPress: ignore },
    stop: { shown: false, onPress: ignore },
    status: undefined,
    live: false,
    sidePanel: {
      open: false,
      tab: SIDE_PANEL_TAB.BOARD,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      onToggle: ignore,
      onChoose: ignore,
      onResize: ignore,
    },
    board: undefined,
    code: undefined,
    onSelect: ignore,
    onChooseFolder: ignore,
    onRevealFolder: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewPlan: ignore,
    onCancelNew: ignore,
    onLeavePlan: ignore,
    onDeletePlan: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    back: () => false,
    ...overrides,
  };
}
