/**
 * workspace-tools-model.ts -- whether `run_on_mac` is on for an agent and why not, as its MCP popover says it.
 *
 * `run_on_mac` is on for an agent unless one of three things stops it,
 * said in this order: this Mac's Settings › This Mac lets no agent run
 * commands on it, which only the agent's starter reading on a Mac can be
 * told; no Mac of the starter's is listening for commands; or someone
 * other than the starter has put words into the agent's conversation,
 * which turns it off for the rest of the agent's life. This Mac's setting
 * is the reason only where the service says `run_on_mac` is off, because
 * the service counts any listening Mac of the starter's: one set to Never
 * beside another that listens still runs the agent's commands there.
 */

import { PRODUCT_NAME } from "./product-name.js";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "./workspace-tools-wire.js";

/** Why `run_on_mac` is off for an agent, the service's reason and the one this Mac knows first. */
export const RUN_ON_MAC_REASON = {
  SETTINGS_OFF: "settings-off",
  ...RUN_ON_MAC_OFF,
} as const;

export type RunOnMacReason = (typeof RUN_ON_MAC_REASON)[keyof typeof RUN_ON_MAC_REASON];

/** What we say of each reason, in the hint over the popover's `run_on_mac off`. */
export const RUN_ON_MAC_REASON_WORDS = {
  [RUN_ON_MAC_REASON.SETTINGS_OFF]: "Turned off in Settings › This Mac",
  [RUN_ON_MAC_REASON.MAC_AWAY]: `${PRODUCT_NAME} isn't open on the Mac this agent's commands run on, or it stopped listening.`,
} as const satisfies Record<RunOnMacReason, string>;

/** What decides whether `run_on_mac` is on: this Mac's setting, where the reader may be told it, and the service's answer. */
export interface RunOnMacInput {
  /** Whether this Mac's Settings let no agent run commands on it; false where the reader is not the agent's starter or reads on no Mac. */
  readonly settingsOff: boolean;
  /** The service's answer; nothing while it is read or where it could not be. */
  readonly standing: RunOnMacStanding | undefined;
}

/** Why `run_on_mac` is off for the agent, the first of the three reasons that holds; nothing where it is on, or not known to be off. */
export function runOnMacReason(input: RunOnMacInput): RunOnMacReason | undefined {
  const { standing } = input;
  // Note that the service's answer comes first, because another Mac of the starter's may listen while this one is set to Never.
  if (standing === undefined || standing.on) return undefined;
  return input.settingsOff ? RUN_ON_MAC_REASON.SETTINGS_OFF : standing.reason;
}
