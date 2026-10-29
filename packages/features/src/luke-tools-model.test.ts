import { describe, expect, it } from "vitest";
import { RUN_ON_MAC_REASON, runOnMacReason } from "./luke-tools-model.js";
import { RUN_ON_MAC_OFF } from "./luke-tools-wire.js";

/**
 * Why `run_on_mac` is off, in the order the popover says it: this Mac's
 * Settings first, since it is the one the reader can mend there and then,
 * but only where the service says it is off, since another Mac may listen;
 * on, or unread, says nothing.
 */
describe("runOnMacReason", () => {
  it.each([
    {
      case: "Settings off before a Mac away",
      settingsOff: true,
      standing: { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY },
      expected: RUN_ON_MAC_REASON.SETTINGS_OFF,
    },
    {
      case: "Settings off before outside words",
      settingsOff: true,
      standing: { on: false, reason: RUN_ON_MAC_OFF.OUTSIDE_WORDS },
      expected: RUN_ON_MAC_REASON.SETTINGS_OFF,
    },
    {
      case: "nothing for Settings off while another Mac listens",
      settingsOff: true,
      standing: { on: true },
      expected: undefined,
    },
    {
      case: "nothing for Settings off while the service is unread",
      settingsOff: true,
      standing: undefined,
      expected: undefined,
    },
    {
      case: "a Mac away",
      settingsOff: false,
      standing: { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY },
      expected: RUN_ON_MAC_REASON.MAC_AWAY,
    },
    {
      case: "outside words",
      settingsOff: false,
      standing: { on: false, reason: RUN_ON_MAC_OFF.OUTSIDE_WORDS },
      expected: RUN_ON_MAC_REASON.OUTSIDE_WORDS,
    },
    { case: "on", settingsOff: false, standing: { on: true }, expected: undefined },
    { case: "unread", settingsOff: false, standing: undefined, expected: undefined },
  ] as const)("$case", ({ settingsOff, standing, expected }) => {
    expect(runOnMacReason({ settingsOff, standing })).toBe(expected);
  });
});
