import { describe, expect, it } from "vitest";
import { RUN_ON_MAC_REASON, runOnMacReason } from "./workspace-tools-model.js";
import { RUN_ON_MAC_OFF } from "./workspace-tools-wire.js";

describe("runOnMacReason", () => {
  it.each([
    {
      case: "Settings off before a Mac away",
      settingsOff: true,
      standing: { on: false, reason: RUN_ON_MAC_OFF.MAC_AWAY },
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
    { case: "on", settingsOff: false, standing: { on: true }, expected: undefined },
    { case: "unread", settingsOff: false, standing: undefined, expected: undefined },
  ] as const)("$case", ({ settingsOff, standing, expected }) => {
    expect(runOnMacReason({ settingsOff, standing })).toBe(expected);
  });
});
