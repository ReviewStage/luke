import type { AppBridge } from "../../src/shared/contracts";

export type SpokenSettingBridge = Pick<AppBridge, "updateSetting" | "updateSettingEntry">;

/** Names a fixture bridge with the same contract applySpokenSetting validates. */
export function spokenSettingBridge(bridge: SpokenSettingBridge): SpokenSettingBridge {
  return bridge;
}
