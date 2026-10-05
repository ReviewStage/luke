import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../renderer/planning/planning-model";
import type { PlansControl } from "../renderer/planning/use-plans-tab";

const ignore = () => undefined;

/** A signed-in Plans tab on its list page with no plans, every press ignored. */
export function plansControl(overrides: Partial<PlansControl> = {}): PlansControl {
  return {
    page: PLANS_PAGE.LIST,
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
    onSelect: ignore,
    onChooseFolder: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewPlan: ignore,
    onCancelNew: ignore,
    onLeavePlan: ignore,
    back: () => false,
    ...overrides,
  };
}
